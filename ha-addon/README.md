# Budget Assistant - Home Assistant add-on

Packaging for running Budget Assistant as a Home Assistant Supervisor
add-on. See the epic tracking issue and `docs/home-assistant-addon.md`
(added once issue #8 lands) for the full install runbook.

**Bump `config.yaml`'s `version` in every PR that changes anything under
`ha-addon/` or that changes app source the published image needs (anything
`.github/workflows/publish-image.yml` triggers on).** HA Supervisor treats
an unchanged version as "nothing to update" for a local add-on and won't
re-pull the base image even after a fresh one is published to GHCR - the
symptom is the add-on silently keeps running old code after a merge, with
no error to indicate why.

## Current scope (issues #5 + #6)

Packaging and process supervision (#5): Postgres 16 + the Next.js app + the
SimpleFin worker + the backup cron, all consolidated into one add-on
container via s6-overlay, since HA add-ons are conventionally
single-container. Also creates the initial household/user/membership from
the `household_login_email`/`household_login_password` options if no user
with that email exists yet (`scripts/ensure-household-login.ts`, run once
after migrations, idempotent) - the plain Docker Compose deployment instead
seeds this manually via the gitignored `scripts/seed.ts`, which has no
equivalent inside this add-on's image.

Ingress-compatible routing (#6): an nginx service in front of the app
(`rootfs/etc/nginx/http.d/ingress.conf`) is now the container's only
listener on `ingress_port` (8099) - the app itself moved to a loopback-only
internal port. nginx uses `sub_filter` to rewrite the small set of
root-absolute asset references the app emits server-side (`/_next/...`,
`/manifest.json`, `/favicon.ico`) using the `X-Ingress-Path` header HA's
Supervisor sends with every proxied request.

**This does not (and cannot) fix client-side router navigation** -
`<Link>`, RSC prefetch, and Server Action POSTs build root-absolute URLs at
runtime from Next's build-time `basePath` (which has to stay empty, since
HA's ingress path is a per-install runtime token, not something bakeable
at build time). Whether tab-to-tab navigation survives ingress can only be
confirmed against a real HA Supervisor - that's Gate A in issue #7, before
any real data migrates.

## Local build + smoke test (no HA Supervisor required)

Use a real `/data/options.json` rather than plain `-e` flags for the option
values - **s6-overlay clears the incoming container environment by
default**, so plain `docker run -e ...` vars are invisible to `cont-init.d`
unless you also set `S6_KEEP_ENV=1` (which was tried and reverted here: it
introduced a startup race that made Postgres's own `DATABASE_URL`, itself
synthesized in `cont-init.d/20-postgres.sh`, intermittently vanish before
`migrate` read it). Testing via `options.json` sidesteps this entirely
*and* exercises the exact same code path the real HA deployment uses.

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

# 5. Verify plain (no-ingress-header) behavior still works
docker logs budget-addon-test          # postgres init, migrations, worker, app, nginx all start
curl http://localhost:18100/api/health # {"status":"ok"}
curl -i http://localhost:18100/        # redirects to /login

# 6. Simulate an HA ingress request (fake token path + header) and confirm
#    the HTML now references the prefixed asset paths
curl -s -H "X-Ingress-Path: /api/hassio_ingress/TESTTOKEN" http://localhost:18100/login \
  | grep -o '/api/hassio_ingress/TESTTOKEN/_next/[^"]*' | head -3

# 7. Confirm the actual login flow (not just that the page renders)
COOKIES=/tmp/cookies.txt
CSRF_TOKEN=$(curl -s -c $COOKIES http://localhost:18100/api/auth/csrf | grep -o '"csrfToken":"[^"]*"' | cut -d'"' -f4)
curl -s -b $COOKIES -c $COOKIES -i -X POST http://localhost:18100/api/auth/callback/credentials \
  -d "email=test@example.com" -d "password=testpassword123" -d "csrfToken=$CSRF_TOKEN" -d "json=true" \
  | grep -i "set-cookie: authjs.session-token"

# Cleanup
docker rm -f budget-addon-test
docker volume rm budget-addon-data
```

Verified working end to end on 2026-07-24: first-boot Postgres init +
`budget` role/database creation, migrations applying cleanly, the worker
scheduling its SimpleFin sync cron, the app serving and health-checking,
a manual backup landing in `/data/backups` via `scripts/backup/backup.sh`
(symlinked from `/backups`, which the script hardcodes), a full container
restart correctly skipping re-init and reusing the persisted Postgres
password and correctly no-op'ing the household-login bootstrap the second
time, a simulated `X-Ingress-Path` header correctly rewriting `/_next/`,
`/manifest.json`, and `/favicon.ico` references in the served HTML, and a
real credentials sign-in producing a valid `authjs.session-token` cookie.

## A note on s6-rc oneshots

`migrate`'s `up` file is intentionally a bare one-line `exec` into
`rootfs/etc/s6-overlay/scripts/run-migrate.sh`, rather than containing the
wait-for-postgres/migrate logic directly. s6-rc parses **oneshot**
`up`/`down` files differently from a **longrun** service's `run` file - a
`run` file (like `postgres/run`, `app/run`) is kernel-exec'd directly and
can contain arbitrary shell syntax, but a oneshot's `up` file broke on a
`||` inside it (`execline-cd: fatal: unable to exec ||`) even though the
identical file worked fine when exec'd directly outside of s6-rc's oneshot
machinery. Keeping real logic in a separate, normally-exec'd script and
having `up` do nothing but `exec` into it sidesteps this entirely - apply
the same pattern to any future oneshot service added here.
