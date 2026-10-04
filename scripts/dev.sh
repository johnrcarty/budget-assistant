#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$APP_DIR"
if [[ ! -x .venv/bin/python ]]; then
  printf '%s\n' 'Create the Python environment first: python3 -m venv .venv' 'Then: .venv/bin/pip install -r backend/requirements.txt'
  exit 1
fi
if [[ ! -d frontend/node_modules ]]; then
  printf '%s\n' 'Install the frontend first: npm --prefix frontend install'
  exit 1
fi
export BUDGET_AUTH_MODE=${BUDGET_AUTH_MODE:-local}
export BUDGET_LOCAL_AUTH=${BUDGET_LOCAL_AUTH:-true}
export BUDGET_DATA_DIR=${BUDGET_DATA_DIR:-"$APP_DIR/data"}
API_PID=''
UI_PID=''
cleanup() {
  if [[ -n "$API_PID" ]]; then kill "$API_PID" 2>/dev/null || true; fi
  if [[ -n "$UI_PID" ]]; then kill "$UI_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM
.venv/bin/python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000 --no-proxy-headers --reload &
API_PID=$!
(cd frontend && exec ./node_modules/.bin/vite --host 0.0.0.0) &
UI_PID=$!
wait -n "$API_PID" "$UI_PID"
