import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "mcp-handler";

import { registerBudgetTools } from "@/server/lib/mcp/tools";

// MCP endpoint for Home Assistant Assist (and any other MCP client) -
// Streamable HTTP at /api/mcp. The [transport] segment is required by
// mcp-handler's routing; static routes like /api/auth take precedence, so
// this only ever receives /api/mcp (and /api/sse, which needs Redis and is
// deliberately not supported - HA tries Streamable HTTP first and only
// falls back to SSE on a 405).
//
// Auth (issue #3): a single long-lived bearer token from MCP_AUTH_TOKEN -
// proportionate for a single-household app on a LAN. Two ways to present
// it, because Home Assistant's MCP integration only asks for a URL (its
// only alternative is full OAuth discovery, which is exactly the weight
// this deliberately avoids):
//   - Authorization: Bearer <token>   (standard MCP clients)
//   - ?token=<token> in the URL       (Home Assistant)
// Unset MCP_AUTH_TOKEN = endpoint disabled, so the app never exposes
// financial data just by being deployed.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "ping",
      {
        title: "Ping",
        description:
          "Health check for the Monthly Budget MCP server. Returns 'ok' if the connection and auth are working.",
      },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );
    registerBudgetTools(server);
  },
  { serverInfo: { name: "monthly-budget", version: "1.0.0" } },
  { basePath: "/api" },
);

function isAuthorized(request: Request, expected: string): boolean {
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  const provided = bearer ?? new URL(request.url).searchParams.get("token");
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function guardedHandler(request: Request): Promise<Response> {
  const expected = process.env.MCP_AUTH_TOKEN;
  if (!expected) {
    return new Response("MCP endpoint disabled: MCP_AUTH_TOKEN is not set", { status: 503 });
  }
  if (!isAuthorized(request, expected)) {
    // Plain 401 without a WWW-Authenticate challenge: clients with the
    // token never see this, and we don't want HA starting OAuth discovery.
    return new Response("Unauthorized", { status: 401 });
  }
  return handler(request);
}

export { guardedHandler as GET, guardedHandler as POST, guardedHandler as DELETE };
