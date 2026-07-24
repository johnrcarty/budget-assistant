# Budget Assistant — Home Assistant add-on

**Status: working, with true sidebar-native ingress.** Installed as a
local HA add-on — Postgres, the app, the SimpleFin worker, and scheduled
backups all run in one container, managed by HA like any other add-on.
Verified end to end against a real Home Assistant instance: install,
configure, start, log in, navigate between every tab, SimpleFin sync, and
a manual backup all work — through the ingress sidebar panel, on the LAN
and via Nabu Casa remote (`ingress: true` since 0.2.0, epic #70).

## Install

1. In HA: **Settings → Add-ons → Add-on Store → ⋮ (top right) →
   Repositories**, add `https://github.com/johnrcarty/budget-assistant`.
2. Find **Budget Assistant** in the store and install it.
3. On the **Configuration** tab, set:
   - `household_login_email` / `household_login_password` — your login
     for the app itself (created automatically on first boot).
   - `auth_secret` / `simplefin_encryption_key` — random secrets, e.g.
     `openssl rand -hex 32` for each.
   - `backup_retention_days` — how many days of automatic backups to keep.
   - `anthropic_api_key` / `mcp_auth_token` — optional (AI categorization
     suggestions / the Home Assistant Assist MCP integration).
4. Start the add-on — **Budget Assistant** appears in HA's sidebar
   (ingress panel, toggleable via "Show in sidebar" on the add-on's Info
   page). It works anywhere HA itself is reachable, including Nabu Casa
   remote and the companion apps — no exposed port or extra URL needed.

Port 8099 is still published, but only for HA's Model Context Protocol
(Assist) integration, which reaches the MCP endpoint at
`http://127.0.0.1:8099/api/mcp?token=...` — UI access is via ingress.

## How ingress works here

HA's `ingress: true` mode embeds an add-on in the sidebar with no exposed
port, proxied through Supervisor under a dynamic per-install
`/api/hassio_ingress/<token>` path. That's normally fatal for Next.js:
its client-side router builds every navigation URL in the browser from a
build-time `basePath` that can never learn the runtime prefix — the first
ingress attempt 404'd on the very first in-app navigation after login.

The fix (epic #70) removed client-side routing entirely: every navigation
is a plain `<a>` full-page load whose href the *server* builds from the
`X-Ingress-Path` header Supervisor forwards (`src/server/lib/ingress.ts`,
`src/components/layout/ingress.tsx`), and every server-side `redirect()`
is prefixed the same way. nginx's `sub_filter` (below) only rewrites
static-asset references the app can't build per-request (`/_next/`
chunks, manifest, favicon). On the plain LAN/Docker Compose deployment
the header is absent, the prefix is empty, and URLs are unchanged.

Not yet exercised through ingress: CSV import and Backup & Restore
uploads (Supervisor may impose its own request-body limits independent of
this add-on's nginx `client_max_body_size 512m`). If a large upload fails
through the sidebar panel, retry via the direct port as a workaround and
file an issue.

## Architecture

Postgres 16 + the Next.js app + the SimpleFin worker + a backup cron, all
consolidated into one container via s6-overlay — HA add-ons are
conventionally single-container, where this app is normally four separate
Docker Compose services. `ha-addon/Dockerfile` layers this onto the
existing app image (`ghcr.io/johnrcarty/budget-assistant`, published by
`.github/workflows/publish-image.yml`); the root `Dockerfile` and
`docker-compose.yml` (the plain LAN deployment) are untouched.

On first boot, creates the household/user/membership from the configured
login if none exists yet (`scripts/ensure-household-login.ts`, idempotent)
— the plain Docker Compose deployment instead seeds this manually via the
gitignored `scripts/seed.ts`, which has no equivalent inside this add-on's
image.

**Bump `config.yaml`'s `version` in every PR that changes anything under
`ha-addon/` or that changes app source the published image needs.** HA
Supervisor treats an unchanged version as "nothing to update" for a local
add-on and won't re-pull the base image even after a fresh one lands on
GHCR — the symptom is the add-on silently keeps running old code after a
merge, with no error to indicate why.

## Local build + smoke test (no HA Supervisor required)

Use a real `/data/options.json` rather than plain `-e` flags for the option
values (see the s6-overlay note below for why) — this also exercises the
exact same code path the real HA deployment uses.

```sh
# 1. Build the app image this add-on extends (from the repo root)
docker build -t budget-assistant:dev .

# 2. Build the add-on image
cd ha-addon
docker build --build-arg BUILD_FROM=budget-assistant:dev -t budget-assistant-addon:dev .

# 3. Seed a real options.json into the /data volume
docker volume create budget-addon-data
cat > /tmp/options.json <<EOF
{
  "household_login_email": "test@example.com",
  "household_login_password": "testpassword123",
  "auth_secret": "$(openssl rand -hex 32)",
  "simplefin_encryption_key": "$(openssl rand -hex 32)",
  "anthropic_api_key": "",
  "mcp_auth_token": "",
  "backup_retention_days": 14
}
EOF
docker run --rm -v budget-addon-data:/data -v /tmp/options.json:/tmp/options.json:ro \
  alpine cp /tmp/options.json /data/options.json

# 4. Run it
docker run -d --name budget-addon-test \
  -v budget-addon-data:/data \
  -p 18100:8099 \
  budget-assistant-addon:dev

# 5. Verify
docker logs budget-addon-test          # postgres init, migrations, worker, app, nginx all start
curl http://localhost:18100/api/health # {"status":"ok"}
curl -i http://localhost:18100/        # redirects to /login

# Cleanup
docker rm -f budget-addon-test
docker volume rm budget-addon-data
```

Verified end to end (most recently 2026-07-24, real HA instance): first-boot
Postgres init + household/user creation, migrations applying, the worker
scheduling its SimpleFin sync cron, login + full navigation between every
tab, a manual backup landing in `/data/backups`, and a full container
restart correctly reusing existing data with no re-init. Ingress (0.2.0)
verified the same day: login + full navigation through the real sidebar
panel, on the LAN and via Nabu Casa remote.

## Implementation notes / gotchas

Kept for whoever touches this next — each of these cost real debugging
time against a real HA instance.

**s6-rc oneshots vs. longrun `run` scripts.** `migrate`'s `up` file is a
bare one-line `exec` into `rootfs/etc/s6-overlay/scripts/run-migrate.sh`,
rather than containing the wait-for-postgres/migrate logic directly. s6-rc
parses **oneshot** `up`/`down` files differently from a **longrun**
service's `run` file — a `run` file (like `postgres/run`, `app/run`) is
kernel-exec'd directly and can contain arbitrary shell syntax, but a
oneshot's `up` file broke on a `||` inside it
(`execline-cd: fatal: unable to exec ||`) even though the identical file
worked fine exec'd directly outside of s6-rc's oneshot machinery. Keep real
logic in a separate, normally-exec'd script; have `up` do nothing but
`exec` into it.

**s6-overlay clears the incoming container environment by default.** Plain
`docker run -e ...` vars are invisible to `cont-init.d` unless you also set
`S6_KEEP_ENV=1` — tried and reverted here, since it introduced a startup
race that made `cont-init.d/20-postgres.sh`'s own synthesized `DATABASE_URL`
intermittently vanish before `migrate` read it. Doesn't affect the real HA
deployment (which reads `/data/options.json`, a file, not inherited env
vars) — for local testing, use a real `options.json` instead (see above).

**nginx's `$host` strips the port — use `$http_host`.** This one only
surfaced on a real HA instance: `proxy_set_header Host $host;` forwards a
port-stripped host (nginx's own well-documented behavior), while the
browser's `Origin` header naturally includes the port. Next.js's built-in
Server Actions CSRF check compares these and aborts on any mismatch —
which silently broke every Server Action, including the login form itself.
Fixed by forwarding `$http_host` (which preserves the port) for both `Host`
and `X-Forwarded-Host`. Caught only by testing a real Server Action
submission through nginx (a real browser, or headless Chromium) — hitting
`/api/auth/callback/credentials` directly with curl bypasses Next's Server
Actions machinery entirely and never exercises this check.
