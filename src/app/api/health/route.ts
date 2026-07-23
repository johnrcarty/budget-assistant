import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

// Unauthenticated liveness/readiness check for infra (reverse proxies,
// HA ingress once that lands, uptime monitors) - mirrors the MCP `ping`
// tool's connectivity check but doesn't require MCP_AUTH_TOKEN, since this
// exposes no household data, only "can this process reach its database."
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "error" }, { status: 503 });
  }
}
