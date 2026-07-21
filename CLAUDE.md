@AGENTS.md

# Monthly Budget — Project Guide for Agents

Self-hosted, zero-based budgeting and finance tracker built to replace
EveryDollar without paywalling transaction sync. Single household, shared
login, self-hosted via Docker on the owner's own server/NAS. Full context:
`README.md`.

## Workflow — read this before making any change

**Never commit or push directly to `main`.** For every change:

1. Create a feature branch off `main` (e.g. `git checkout -b feat/mcp-server`).
2. Make the change, commit there.
3. Open a PR into `main` (`gh pr create`). Do not merge it yourself unless
   explicitly told to — leave it for the repo owner to review and merge,
   unless you've been given standing permission to merge your own PRs.

This applies to every session/agent working in this repo, not just the one
that set up this rule. `main` should only ever move forward via merged PRs.

## Stack

Next.js 16 (App Router) + TypeScript, Drizzle ORM + PostgreSQL, Auth.js
(Credentials + JWT sessions today; DB-session-ready for an Authentik OIDC
provider later), Tailwind v4 + shadcn/ui (Base UI primitives, **not**
Radix — no `asChild`, use the `render` prop or pass props directly to
`DialogTrigger`/`Select` etc.), SimpleFin for bank sync, self-hosted via
Docker Compose (`db` + `app` + `worker`).

## Conventions that matter

- **Money is always integer cents**, never floats. `dollarsToCents`/
  `formatCents` in `src/server/lib/money.ts`.
- **Liability balances are always stored positive** (amount owed), both on
  `accounts.currentBalanceCents` and every `debt_balance_snapshots` row.
  SimpleFin's API returns liability balances *negative* — the sync job
  normalizes this with `Math.abs()`. Don't remove that normalization.
- **Debt terms/balance history is append-only.** `debt_terms_versions` and
  `debt_balance_snapshots` are never edited in place, only inserted. "Current"
  values are resolved as "most recent row at-or-before today" (see
  `src/server/db/queries/debt.ts`) specifically so the system tolerates
  missing months and mid-history changes (rate changes, servicer transfers)
  without breaking.
- **Transaction idempotency**: `transactions` has a unique constraint on
  `(accountId, source, externalId)`. Manual entries have `externalId = null`
  (Postgres treats NULLs as distinct, so they never collide). SimpleFin sync
  and CSV import both upsert on this constraint — CSV import derives a
  content hash (date+description+amount) as its `externalId` since bank CSVs
  don't carry a stable id.
- **Budget line items use a template/instance split**: `line_item_templates`
  is the recurring "idea", `budget_line_items` is the editable-per-month
  instance. Category changes move both (so future months follow); planned
  amount/due-date changes only affect the current month's instance.
- **`getCurrentHousehold()`/`verifySession()`** (in `src/server/lib/dal.ts`)
  require a live Next.js request context (cookies/session) — they will throw
  if called from a standalone script. When writing verification/seed
  scripts, call the underlying query/job functions directly with an explicit
  `householdId` instead of going through DAL-gated Server Actions.
- **`server-only` is deliberately NOT used** on `db/client.ts` or the
  `queries/*` modules, specifically so they're callable from standalone
  `tsx` scripts (seed/verification scripts). It's still used where a client
  import would be a real accidental-secret-exposure risk (`dal.ts`).
- **This Next.js version (16) has real breaking changes from training data**
  — see `AGENTS.md` above and `node_modules/next/dist/docs/` before assuming
  an API works the way you remember. Concretely: `middleware.ts` is now
  `proxy.ts` (must live under `src/` for this project's layout), and it
  lives in `src/proxy.ts`, not the repo root.
- **This project's ESLint config enforces React Compiler purity rules**
  (`react-hooks/set-state-in-effect`, `react-hooks/refs`, `react-hooks/purity`)
  more strictly than typical Next.js configs. Common patterns that will fail
  lint here: `useEffect(() => setState(...), [])` for a mounted flag (use
  `useSyncExternalStore` instead), reading/writing `ref.current` during
  render, calling `Date.now()` during a component's render body (use
  `new Date().getTime()`).

## Self-hosted deployment

The owner runs this via `docker compose --env-file .env.local up -d --build
app worker` on their own server (LAN-accessible, not this dev machine).
After merging a change that should go live, that rebuild is a separate,
explicit step — ask before running it against the owner's real deployment
unless told otherwise, since it affects a shared/real system with real
financial data connected (a live SimpleFin bank connection).

## Testing

No automated test suite exists yet as of this writing — verification during
development was done via manual/scripted checks (throwaway `tsx` scripts
calling query/job functions directly against the dev DB, cleaned up after).
See the "Add automated test suite" epic in GitHub Issues for what's planned.
If you add tests, prefer testing the query/job layer directly (it has no
Next.js request-context dependency) over trying to test Server Actions or
Route Handlers in isolation.
