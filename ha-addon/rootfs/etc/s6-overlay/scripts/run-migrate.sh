#!/command/with-contenv sh
# s6-rc's oneshot up/down files are parsed specially (not plain kernel-exec'd
# like a longrun's run script) and choke on shell operators like `||` - so
# the actual logic lives here, and migrate/up is just a bare one-line exec
# into this file.
cd /app || exit 1

i=0
until pg_isready -h 127.0.0.1 -p 5432 -U budget -d monthly_budget >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "[migrate] postgres never became ready after 60s" >&2
    exit 1
  fi
  sleep 1
done

exec node_modules/.bin/tsx src/server/db/migrate.ts
