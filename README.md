# Monthly Budget

A self-hosted, zero-based budgeting and finance tracker for one household —
built to replace EveryDollar without paywalling transaction sync.

Stack: Next.js 16 (App Router) + TypeScript, Drizzle ORM + PostgreSQL,
Auth.js (Credentials now, Authentik OIDC-ready later), SimpleFin for bank
sync, Claude Haiku for optional AI categorization, self-hosted via Docker
Compose. Architecture and working conventions live in `CLAUDE.md`.

## What it does

- **Summary** — Sankey cashflow diagram (income → categories → line items,
  surplus/deficit) over selectable ranges, upcoming unpaid bills, needs-review
  banner, current-month budget status.
- **Budget** — zero-based monthly budgeting with recurring templates and
  per-month instances, category groups with per-mode totals
  (planned/spent/remaining), income paycheck slots with received-vs-planned,
  and an app-managed Debt section fed by linked debt accounts.
- **Transactions** — SimpleFin bank sync (worker polls on a schedule), CSV
  import with column mapping and idempotent dedup, manual entry, search/
  filter/pagination, and a categorization hub: pattern rules (description +
  optional account/amount conditions, priorities) that run on every sync and
  import, plus optional Claude Haiku suggestions that propose review-first
  rules for uncategorized merchants. Income rules fill numbered paycheck
  slots ("Person A 1/2") in deposit order.
- **Accounts** — assets and liabilities with section totals, tap-to-edit
  (name/type), archive/unarchive, SimpleFin connection management.
- **Debt payoff** (More → Debt Payoff) — per-debt terms history (APR,
  payment frequency incl. biweekly, percent-of-balance minimums, escrow
  passthrough) and balance snapshots; a household payoff plan with
  snowball/avalanche strategies, extra-payment rollover simulation,
  minimums-only baseline ("interest saved / months sooner"), and a
  burn-down chart of history + projection.
- **Income tracker** (More → Income Tracker) — annual W2/1099 income per
  person with optional withholdings, CSV import (spreadsheet-style wide
  layout supported), and forecasts saved as frozen snapshots (growth-pattern
  and linear-regression models) so old projections stay comparable against
  actuals.
- Dark/light theme (More → Appearance), mobile-first bottom-tab UI.

## Local development

```bash
docker compose up -d db          # local Postgres
pnpm install
cp .env.example .env.local       # fill in AUTH_SECRET, SIMPLEFIN_ENCRYPTION_KEY (openssl rand -base64 32), household login
pnpm run db:migrate
pnpm run seed                    # creates the household + login user from .env.local
pnpm dev
```

Verification scripts for the pure math modules (no DB needed):

```bash
npx tsx scripts/verify-debt-sim.ts
npx tsx scripts/verify-income-forecast.ts
npx tsx scripts/verify-income-slots.ts
```

## Self-hosting (production)

```bash
cp .env.example .env.local       # same as above
docker compose --env-file .env.local up -d --build
docker compose --env-file .env.local exec app node_modules/.bin/tsx scripts/seed.ts
```

`docker-compose.yml` runs three services: `db` (Postgres), `app` (runs
migrations then serves Next.js), and `worker` (scheduled SimpleFin polling +
rule-based auto-categorization).

Optional: set `ANTHROPIC_API_KEY` in `.env.local` to enable AI
categorization suggestions (Claude Haiku, review-first — nothing applies
without approval). Everything else works without it.

## Status

- [x] Phase 1 — scaffold, auth, Docker
- [x] Phase 2 — core budgeting CRUD
- [x] Phase 3 — manual transactions
- [x] Phase 4 — SimpleFin sync
- [x] Phase 5 — debt tracking module
- [x] Summary page (Sankey cashflow, upcoming bills)
- [x] Debt payoff planner (snowball/avalanche simulator, burn-down chart)
- [x] Annual income tracker with snapshot forecasts
- [x] Transaction categorization (rules + AI suggestions, income slot filling)
- [ ] MCP server for Home Assistant Assist (epic #14)
- [ ] Home Assistant ingress add-on (epic #15)
- [ ] Automated test suite (epic #16 — verification is via `scripts/verify-*.ts` today)
