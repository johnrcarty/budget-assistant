# Monthly Budget

A self-hosted, zero-based budgeting and finance tracker — built to replace
EveryDollar without paywalling transaction sync. See
`/root/.claude/plans/root-claude-uploads-26e3eb51-44de-4ed1-smooth-leaf.md`
for the full design/data-model plan this was built from.

Stack: Next.js (App Router) + TypeScript, Drizzle ORM + PostgreSQL, Auth.js
(Credentials now, Authentik OIDC-ready later), SimpleFin for bank sync,
self-hosted via Docker Compose.

## Local development

```bash
docker compose up -d db          # local Postgres
pnpm install
cp .env.example .env.local       # fill in AUTH_SECRET, SIMPLEFIN_ENCRYPTION_KEY (openssl rand -base64 32), household login
pnpm run db:migrate
pnpm run seed                    # creates the household + login user from .env.local
pnpm dev
```

## Self-hosting (production)

```bash
cp .env.example .env.local       # same as above
docker compose --env-file .env.local up -d --build
docker compose --env-file .env.local exec app node_modules/.bin/tsx scripts/seed.ts
```

`docker-compose.yml` runs three services: `db` (Postgres), `app` (runs
migrations then serves Next.js), and `worker` (scheduled SimpleFin polling,
Phase 4).

## Status

- [x] Phase 1 — scaffold, auth, Docker
- [ ] Phase 2 — core budgeting CRUD
- [ ] Phase 3 — manual transactions
- [ ] Phase 4 — SimpleFin sync
- [ ] Phase 5 — debt tracking module
