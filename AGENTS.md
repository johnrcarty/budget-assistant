# BudgetAssistant working conventions

This is the Python/React rebuild. The old Next.js implementation remains in Git history; do not assume its runtime or database schema applies here.

- Work on a feature branch and open a pull request. Do not commit or push to `main`, or merge without the owner's instruction.
- Local development is authorized. Changes to the existing deployment, live bank connection, or a real Home Assistant installation require explicit deployment instructions.
- Backend: `backend.app:app`, FastAPI and SQLite. Frontend: React/Vite in `frontend/`, compiled and served by Python at the same origin. Use relative API URLs and the server-injected base for ingress.
- Store monetary values as integer cents. Transactions use positive inflows and negative outflows. Normalize liability display with the account kind; do not sum unrelated currencies.
- Every read and mutation must enforce household membership, scope, and personal ownership on the server. Personal sharing exposes aggregate amounts only. The HA automation token is separate from user JWT authentication and must remain household-bills-only.
- Trust official ingress user headers only from the configured actual socket peer. Always start Uvicorn with `--no-proxy-headers`.
- SimpleFIN credentials remain encrypted on the server. Preserve import idempotency, deletion exclusions, categories, and manual amount overrides. Never log or return setup tokens or access URLs.
- Preserve paid bill occurrences. Recurrence keeps the original calendar day and clamps in shorter months; unpaid prior months do not suppress upcoming reminders.
- Keep reusable components in `frontend/src/components/`, views in `frontend/src/pages/`, and formatting/API helpers in `frontend/src/lib/`.
- Run `.venv/bin/python -m pytest tests -q` and `npm --prefix frontend run build`. Tests use temporary databases and mocked bank feeds. In a sandbox that blocks socket pairs, request scoped execution permission for pytest; do not weaken the tests.
