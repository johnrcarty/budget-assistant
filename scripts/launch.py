"""Launch the same server locally, in Docker, or under HA Supervisor."""

import json
import os
from pathlib import Path
import sys


def main():
    options_path = Path("/data/options.json")
    if options_path.exists():
        # Supervisor options are configuration, never shell input.
        options = json.loads(options_path.read_text())
        os.environ.setdefault("BUDGET_DATA_DIR", "/data")
        os.environ.setdefault("BUDGET_AUTH_MODE", "ingress")
        os.environ.setdefault("BUDGET_LOCAL_AUTH", "false")
        os.environ.setdefault("BUDGET_DEMO", "0")
        os.environ.setdefault("BUDGET_TIMEZONE", options.get("timezone", "America/New_York"))
    os.execv(sys.executable, [
        sys.executable, "-m", "uvicorn", "backend.app:app",
        "--host", "0.0.0.0", "--port", "8099", "--no-proxy-headers",
    ])


if __name__ == "__main__":
    main()
