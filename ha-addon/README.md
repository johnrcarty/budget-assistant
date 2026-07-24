# Budget Assistant - Home Assistant add-on

Packaging for running Budget Assistant as a Home Assistant Supervisor
add-on. See the epic tracking issue and `docs/home-assistant-addon.md`
(added once issue #8 lands) for the full install runbook.

## Current scope (issues #5 + #6)

Packaging and process supervision (#5): Postgres 16 + the Next.js app + the
SimpleFin worker + the backup cron, all consolidated into one add-on
container via s6-overlay, since HA add-ons are conventionally
single-container.

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

```sh
# 1. Build the app image this add-on extends (from the repo root)
docker build -t budget-assistant:dev .

# 2. Build the add-on image
cd ha-addon
docker build --build-arg BUILD_FROM=budget-assistant:dev -t budget-assistant-addon:dev .

# 3. Run it with a persistent /data volume and the option env vars
#    (mirrors what HA would inject via /data/options.json - see
#    cont-init.d/10-options.sh for the options.json vs. plain-env fallback)
docker run -d --name budget-addon-test \
  -v budget-addon-data:/data \
  -e HOUSEHOLD_LOGIN_EMAIL=test@example.com \
  -e HOUSEHOLD_LOGIN_PASSWORD=testpassword123 \
  -e AUTH_SECRET="$(openssl rand -hex 32)" \
  -e SIMPLEFIN_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e BACKUP_RETENTION_DAYS=14 \
  -p 18100:8099 \
  budget-assistant-addon:dev

# 4. Verify plain (no-ingress-header) behavior still works
docker logs budget-addon-test          # postgres init, migrations, worker, app, nginx all start
curl http://localhost:18100/api/health # {"status":"ok"}
curl -i http://localhost:18100/        # redirects to /login

# 5. Simulate an HA ingress request (fake token path + header) and confirm
#    the HTML now references the prefixed asset paths
curl -s -H "X-Ingress-Path: /api/hassio_ingress/TESTTOKEN" http://localhost:18100/login \
  | grep -o '/api/hassio_ingress/TESTTOKEN/_next/[^"]*' | head -3

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
password, and - once nginx landed - a simulated `X-Ingress-Path` header
correctly rewriting `/_next/`, `/manifest.json`, and `/favicon.ico`
references in the served HTML.

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
