#!/bin/sh
# Bridges Home Assistant's /data/options.json into env vars every service
# picks up via `with-contenv` (s6-overlay reads /var/run/s6/container_environment/*
# into every service that uses that shebang). Falls back to reading real
# container env vars when options.json doesn't exist, so this same image
# also runs under a plain `docker run -e ...` for local testing outside HA
# Supervisor.
set -eu

ENV_DIR=/var/run/s6/container_environment
mkdir -p "$ENV_DIR"
OPTIONS_FILE=/data/options.json

opt() {
  # $1 = options.json key, $2 = fallback real env var name
  if [ -f "$OPTIONS_FILE" ]; then
    jq -r --arg k "$1" '.[$k] // empty' "$OPTIONS_FILE"
  else
    printenv "$2" 2>/dev/null || true
  fi
}

set_env() {
  printf '%s' "$2" >"${ENV_DIR}/$1"
}

set_env HOUSEHOLD_LOGIN_EMAIL "$(opt household_login_email HOUSEHOLD_LOGIN_EMAIL)"
set_env HOUSEHOLD_LOGIN_PASSWORD "$(opt household_login_password HOUSEHOLD_LOGIN_PASSWORD)"
set_env AUTH_SECRET "$(opt auth_secret AUTH_SECRET)"
set_env SIMPLEFIN_ENCRYPTION_KEY "$(opt simplefin_encryption_key SIMPLEFIN_ENCRYPTION_KEY)"
set_env ANTHROPIC_API_KEY "$(opt anthropic_api_key ANTHROPIC_API_KEY)"
set_env MCP_AUTH_TOKEN "$(opt mcp_auth_token MCP_AUTH_TOKEN)"
set_env BACKUP_RETENTION_DAYS "$(opt backup_retention_days BACKUP_RETENTION_DAYS)"

echo "[options] bridged HA options into container_environment"
