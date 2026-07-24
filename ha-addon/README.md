# Budget Assistant - Home Assistant add-on

Packaging for running Budget Assistant as a Home Assistant Supervisor
add-on. See the epic tracking issue and `docs/home-assistant-addon.md`
(added once issue #8 lands) for the full install runbook.

## Current scope (issue #5)

This directory currently covers packaging and process supervision only:
Postgres 16 + the Next.js app + the SimpleFin worker + the backup cron, all
consolidated into one add-on container via s6-overlay, since HA add-ons are
conventionally single-container. `ingress_port` in `config.yaml` points
directly at the app for now - issue #6 adds an nginx layer in front to
rewrite asset paths for HA's ingress path prefix, at which point
`ingress_port` moves to nginx.

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
  -p 18100:3000 \
  budget-assistant-addon:dev

# 4. Verify
docker logs budget-addon-test          # postgres init, migrations, worker, app all start
curl http://localhost:18100/api/health # {"status":"ok"}
curl -i http://localhost:18100/        # redirects to /login

# Cleanup
docker rm -f budget-addon-test
docker volume rm budget-addon-data
```

Verified working end to end on 2026-07-24: first-boot Postgres init +
`budget` role/database creation, migrations applying cleanly, the worker
scheduling its SimpleFin sync cron, the app serving and health-checking,
a manual backup landing in `/data/backups` via `scripts/backup/backup.sh`
(symlinked from `/backups`, which the script hardcodes), and a full
container restart correctly skipping re-init and reusing the persisted
Postgres password.

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
