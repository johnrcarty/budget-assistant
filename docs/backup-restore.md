# Backups & restore

The `backup` service (`docker-compose.yml`) runs `pg_dump` against the `db`
container daily and keeps the last `BACKUP_RETENTION_DAYS` days of dumps in
`./backups` on the host. This is a **database-only** backup — no secrets
are included (see "What's backed up / what's not" below).

## In-app backup & restore (More → Backup & Restore)

The app also has a UI for both directions — no shell access needed, which
matters on installs where the CLI is a pain to reach (the HA add-on
especially):

- **Download backup** runs a fresh `pg_dump` (same flags, format, and
  filename shape as the scheduled job — the files are interchangeable) and
  downloads it to your browser.
- **Restore from a backup** uploads a `.dump` file and restores it in
  place. Destructive, so it mirrors `restore.sh`'s safeguard: you must type
  `restore` to confirm (checked server-side too). It re-runs Drizzle
  migrations automatically afterward, so an older-schema dump catches up on
  its own. If the app acts confused immediately after a restore, restart it
  (Compose: `docker compose restart app worker`; HA: restart the add-on) —
  same guidance as the CLI restore.

The scheduled daily backups keep running regardless — the UI is an
addition, not a replacement. The CLI paths below remain for scripting and
for disaster recovery when the app itself won't start.

**Migrating between installs via the UI** (e.g. dev → the HA add-on): on
the old install, More → Backup & Restore → Download backup. On the new
install, configure it with the **same `SIMPLEFIN_ENCRYPTION_KEY` /
`simplefin_encryption_key`** as the old one and — for the HA add-on — a
`household_login_email` matching the old install's current in-app login
email, then upload the file via Restore. (The add-on's boot-time
`ensure-household-login` matches by email; a mismatched configured email
quietly creates a second empty household on the next add-on restart.)
Then run through steps 7–10 of the host-migration checklist below —
login, SimpleFin check, MCP URL — which apply the same way.

## How scheduled backups work

`backup` is a plain `postgres:16-alpine` container (same image as `db`, so
`pg_dump`/`pg_restore` are always version-matched) running BusyBox `crond`
in the foreground. The schedule lives in `scripts/backup/crontab` (default:
03:00 UTC daily). Each run writes
`./backups/monthly_budget_<UTC-timestamp>.dump` and deletes dumps older
than `BACKUP_RETENTION_DAYS` (default 14, set in `.env.local`).

Check it's healthy any time with `docker compose logs backup` or by
looking for a fresh dated file in `./backups`.

## Manual/on-demand backup

```bash
docker compose exec backup /scripts/backup.sh
```

Produces the same timestamped `.dump` file in `./backups` immediately —
useful before a risky change (e.g. a schema migration or bulk edit).

## What's backed up / what's not

- **Backed up:** every table in the `monthly_budget` database — accounts,
  transactions, budget, debts, SimpleFin connection *records* (including
  account mappings), user login (bcrypt hash), everything.
- **Not backed up (by design):** `SIMPLEFIN_ENCRYPTION_KEY`, `AUTH_SECRET`,
  and any other env var. These live only in `.env.local` on each host and
  must be carried over manually — see the table below.
- There's no file/attachment storage in this app (CSV import is parsed
  in-request, nothing is written to disk), so the DB dump is the entire
  data footprint.

## Restoring

`restore.sh` is deliberately not a one-liner — it requires an explicit
flag and typing the database name to confirm, since it destroys existing
data in the target database.

```bash
docker compose exec -it backup /scripts/restore.sh \
  /backups/monthly_budget_<timestamp>.dump \
  --yes-really-overwrite-database
```

After it finishes: `docker compose restart app worker` (the app's
`command` already re-runs Drizzle migrations on every start, so a restored
dump from an older schema version catches up to the current schema
automatically — no manual migration step needed).

## Migrating to a new host (e.g. the Home Assistant machine)

1. **On the old host:** trigger a fresh manual backup so you're migrating
   the latest data, not yesterday's cron run:
   ```bash
   docker compose exec backup /scripts/backup.sh
   ```
2. Copy the resulting `./backups/monthly_budget_<timestamp>.dump` to the
   new host (scp, USB, whatever's convenient — it's a plain file on disk,
   not locked in a Docker volume).
3. **On the new host:** clone the repo, `cp .env.example .env.local`, and
   fill it in. Recommended: reuse the **exact same**
   `SIMPLEFIN_ENCRYPTION_KEY` and `AUTH_SECRET` as the old host (copy them
   over, don't regenerate) — see the table below for why.
4. `docker compose up -d db backup` (don't start `app`/`worker` yet).
5. Restore into the fresh `db`:
   ```bash
   docker compose exec -it backup /scripts/restore.sh \
     /backups/monthly_budget_<timestamp>.dump \
     --yes-really-overwrite-database
   ```
6. `docker compose --env-file .env.local up -d --build app worker`. The
   app's startup command applies any migrations newer than the dump
   automatically.
7. Log in with your existing household credentials at the new host's URL.
8. **Check SimpleFin:** Settings → bank connections.
   - If you carried over `SIMPLEFIN_ENCRYPTION_KEY` unchanged (step 3),
     the restored connection(s) should just work — the worker's next
     4-hourly sync (or a manual trigger) picks up where it left off, no
     remapping needed.
   - If a connection shows an error status (key wasn't carried over, or
     SimpleFin invalidated the Access URL independently), reconnect it
     from scratch with a new SimpleFin setup token, then go to the
     account-mapping UI in Settings and map each newly-discovered
     SimpleFin account to its matching *existing* (restored) account —
     this is the normal mapping flow, nothing new to build. Transaction
     history won't duplicate on re-sync as long as SimpleFin returns the
     same per-account transaction ids it did before (typical case) — the
     `(accountId, source, externalId)` unique constraint dedupes them.
9. Update `MCP_AUTH_TOKEN` / Home Assistant's MCP integration URL if the
   app's LAN address changed (see `docs/mcp-home-assistant.md`).
10. Once you've confirmed everything on the new host, decommission the
    old one.

### Env vars to carry over manually

| Var | Carry over? | Why |
|---|---|---|
| `SIMPLEFIN_ENCRYPTION_KEY` | Yes, strongly recommended | Keeps existing SimpleFin connections working post-restore with zero remapping. |
| `AUTH_SECRET` | Optional | If skipped, existing login sessions just get invalidated (log back in with restored credentials — no data loss). |
| `ANTHROPIC_API_KEY` | If you use AI categorization | Feature is silently disabled without it. |
| `MCP_AUTH_TOKEN` | If you use HA Assist | Feature returns 503 without it; you can also just rotate it and reconnect HA. |
| `HOUSEHOLD_LOGIN_EMAIL` / `_PASSWORD` | Not needed | Only used by `scripts/seed.ts` on a from-scratch install. **Do not run `pnpm run seed` against a restored DB** — it would try to create a duplicate household/user. |
| `POSTGRES_PASSWORD` | Yes | Needed for `db`/`app`/`worker`/`backup` to agree on the same role password - generate one with `openssl rand -hex 24` on the new host if not reusing the old one (rotating requires an `ALTER USER` against the running instance, not just an env change - see the `db` service's password comment). |
| `DATABASE_URL` | N/A | Regenerated from the new host's own compose setup (`postgres://budget:${POSTGRES_PASSWORD}@db:5432/monthly_budget` inside compose). |
