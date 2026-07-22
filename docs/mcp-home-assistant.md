# Home Assistant Assist integration (MCP)

The app exposes a [Model Context Protocol](https://modelcontextprotocol.io)
server at `/api/mcp` (Streamable HTTP transport) so Home Assistant's Assist
agent can answer questions about your budget:

> "Do I have any bills coming up?"
> "What are my recent transactions?"
> "How's the budget looking this month?"
> "What's our net worth?"
> "How are the debts doing?"

Everything is **read-only** — the tools wrap the same query functions the
app's own pages use, and nothing on this endpoint can modify data.

## 1. Enable the endpoint

The endpoint is disabled (returns 503) until `MCP_AUTH_TOKEN` is set.

```bash
# on the server hosting the app
openssl rand -hex 32          # generate a token, add it to .env.local:
# MCP_AUTH_TOKEN=<the token>

docker compose --env-file .env.local up -d --build app
```

Quick smoke test from any machine on the LAN (expects `ok`):

```bash
curl -s -X POST "http://<app-host>:3410/api/mcp?token=<the token>" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ping","arguments":{}}}'
```

## 2. Connect Home Assistant

Requires the built-in **Model Context Protocol** integration with
Streamable HTTP support (Home Assistant 2026.2 or later).

1. **Settings → Devices & services → Add integration → Model Context
   Protocol**.
2. For the URL, enter the endpoint **with the token in the query string** —
   HA's config flow only asks for a URL (its only other auth option is a
   full OAuth flow, which this deliberately avoids):

   ```
   http://<app-host>:3410/api/mcp?token=<the token>
   ```

3. Finish the flow. The integration connects over Streamable HTTP (it tries
   that first; the legacy SSE fallback is intentionally not served).
4. **Settings → Voice assistants** → pick (or create) the assistant you
   use → under **Conversation agent**, make sure it's an LLM-backed agent
   with **control of Home Assistant / external tools enabled** — the MCP
   tools appear alongside HA's own tools automatically once the
   integration is connected.

Then ask Assist: *"Do I have any bills coming up?"*

## Tools exposed

| Tool | Answers | Arguments |
|---|---|---|
| `ping` | connection/auth health check | — |
| `get_upcoming_bills` | unpaid bills overdue / due today / due in 7 days | — |
| `get_recent_transactions` | newest transactions | `limit` (1–50, default 10), `search` |
| `get_budget_summary` | income received vs planned, left to budget, spend per category | `month` (`YYYY-MM`, default current) |
| `get_account_balances` | every active account balance, asset/debt totals, net worth | — |
| `get_debt_summary` | per-debt balance, APR, projected payoff | — |

## Auth details

- Standard MCP clients (Claude, IDEs, `mcp-remote`) should send
  `Authorization: Bearer <token>` instead of the query parameter — both are
  accepted.
- The token is a single long-lived secret checked with a timing-safe
  compare. Rotate it by changing `MCP_AUTH_TOKEN` and redeploying, then
  updating the URL in HA.
- Anything without a valid token gets a plain `401` (no OAuth challenge),
  and if `MCP_AUTH_TOKEN` is unset the endpoint answers `503` for
  everything — a fresh deployment exposes nothing by default.
- The endpoint is LAN-only in the standard setup (the app isn't exposed to
  the internet). If you ever expose the app publicly, put the MCP endpoint
  behind the same reverse-proxy protections as the rest of the app and use
  HTTPS so the token isn't sent in the clear.
