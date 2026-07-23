#!/bin/sh
# Destructively restores a pg_dump custom-format file into $PGDATABASE,
# REPLACING all current data. Requires an explicit flag AND typing the
# database name to confirm - this is not meant to be a casual one-liner.
#
# Usage (run interactively, not from cron):
#   docker compose exec -it backup /scripts/restore.sh /backups/monthly_budget_<ts>.dump --yes-really-overwrite-database
set -eu

DUMPFILE="${1:-}"
CONFIRM_FLAG="${2:-}"

usage() {
  echo "Usage: restore.sh <path-to-dump-file> --yes-really-overwrite-database" >&2
  exit 1
}

[ -n "$DUMPFILE" ] || usage
[ -f "$DUMPFILE" ] || { echo "[restore] No such file: $DUMPFILE" >&2; exit 1; }
[ "$CONFIRM_FLAG" = "--yes-really-overwrite-database" ] || usage

echo "About to DESTROY and replace all data in database '${PGDATABASE}' on '${PGHOST}'"
echo "using: ${DUMPFILE}"
echo "This cannot be undone. Type the database name (${PGDATABASE}) to continue:"
read -r TYPED
if [ "$TYPED" != "$PGDATABASE" ]; then
  echo "[restore] confirmation did not match - aborting, nothing was touched." >&2
  exit 1
fi

echo "[restore] $(date -u -Iseconds) starting restore..."
pg_restore --clean --if-exists --no-owner --no-privileges -d "$PGDATABASE" "$DUMPFILE"
echo "[restore] $(date -u -Iseconds) restore complete."
echo "[restore] Now restart the app/worker so they reconnect and re-run migrations cleanly:"
echo "  docker compose restart app worker"
