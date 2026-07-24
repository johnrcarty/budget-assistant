#!/bin/sh
# One-time bootstrap of the bundled Postgres cluster under /data/postgres
# (HA's own snapshot system captures /data automatically, so this - not a
# host bind mount - is the durable store). On first boot: initdb, create the
# `budget` role/database, and generate+persist its password. On every boot
# after that: reuse the persisted password untouched, since regenerating it
# would desync from the already-initialized role.
#
# Postgres stays on the 16.x line deliberately (postgresql16 apk package) -
# scripts/backup/{backup.sh,restore.sh} do unmodified pg_dump/pg_restore
# custom-format dumps that must stay version-matched. See
# docs/backup-restore.md.
set -eu

PGDATA=/data/postgres
PW_FILE=/data/.postgres_password
ENV_DIR=/var/run/s6/container_environment
mkdir -p "$ENV_DIR" /data/backups

mkdir -p "$PGDATA"
chown -R postgres:postgres "$PGDATA" /data/backups

# scripts/backup/backup.sh and restore.sh hardcode /backups (matching the
# LAN compose deployment's bind mount) - point that at /data/backups here so
# the scripts stay unmodified and dumps land under HA's snapshotted /data.
ln -sfn /data/backups /backups

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "[postgres-init] first boot: initializing new database cluster at $PGDATA"

  if [ ! -f "$PW_FILE" ]; then
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$PW_FILE"
  fi
  chown postgres:postgres "$PW_FILE"
  chmod 600 "$PW_FILE"

  su-exec postgres initdb -D "$PGDATA" \
    --auth-local=trust --auth-host=scram-sha-256 --username=postgres

  su-exec postgres pg_ctl -D "$PGDATA" -w start \
    -o "-c listen_addresses='' -c unix_socket_directories=/tmp"

  su-exec postgres psql -v ON_ERROR_STOP=1 -h /tmp -U postgres <<-EOSQL
    CREATE ROLE budget WITH LOGIN PASSWORD '$(cat "$PW_FILE")';
    CREATE DATABASE monthly_budget OWNER budget;
EOSQL

  su-exec postgres pg_ctl -D "$PGDATA" -m fast -w stop
  echo "[postgres-init] cluster initialized, budget role/database created"
else
  echo "[postgres-init] existing database cluster found, skipping initdb"
  if [ ! -f "$PW_FILE" ]; then
    echo "[postgres-init] FATAL: $PGDATA exists but $PW_FILE is missing -" >&2
    echo "[postgres-init] cannot recover the budget role's password." >&2
    exit 1
  fi
fi

POSTGRES_PASSWORD="$(cat "$PW_FILE")"
printf '%s' "127.0.0.1" >"${ENV_DIR}/PGHOST"
printf '%s' "5432" >"${ENV_DIR}/PGPORT"
printf '%s' "budget" >"${ENV_DIR}/PGUSER"
printf '%s' "$POSTGRES_PASSWORD" >"${ENV_DIR}/PGPASSWORD"
printf '%s' "monthly_budget" >"${ENV_DIR}/PGDATABASE"
printf 'postgres://budget:%s@127.0.0.1:5432/monthly_budget' "$POSTGRES_PASSWORD" \
  >"${ENV_DIR}/DATABASE_URL"

echo "[postgres-init] done"
