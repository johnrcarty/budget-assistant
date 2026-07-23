#!/bin/sh
# Dumps the monthly_budget database to /backups as a timestamped pg_dump
# custom-format file, then prunes dumps older than BACKUP_RETENTION_DAYS.
# Run on a schedule by crond (see ./crontab) or manually via:
#   docker compose exec backup /scripts/backup.sh
set -eu

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="/backups/monthly_budget_${TIMESTAMP}.dump"

echo "[backup] $(date -u -Iseconds) starting dump of ${PGDATABASE}@${PGHOST} -> ${OUT}"

# Dump to a .tmp path first and mv into place atomically, so a killed/failed
# run never leaves a truncated file that looks valid to restore.sh or to
# the retention prune below.
pg_dump -Fc --no-owner --no-privileges -f "${OUT}.tmp"
mv "${OUT}.tmp" "${OUT}"

echo "[backup] $(date -u -Iseconds) dump complete: $(du -h "${OUT}" | cut -f1)"

echo "[backup] pruning dumps older than ${RETENTION_DAYS} days"
find /backups -maxdepth 1 -name 'monthly_budget_*.dump' -mtime "+${RETENTION_DAYS}" -print -delete

echo "[backup] current backups:"
ls -lh /backups/monthly_budget_*.dump 2>/dev/null || echo "[backup] WARNING: no backup files found after run"
