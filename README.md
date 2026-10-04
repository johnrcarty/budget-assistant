# BudgetAssistant

A local-first budget app for your home: Python/FastAPI, SQLite, and React/Vite. The UI uses warm cream, forest green, terracotta, and an original mid-century visual style. Python serves the compiled React app and its API together, so the runtime needs one process and no Node server or PostgreSQL service.

This is a fresh rebuild of [johnrcarty/budget-assistant](https://github.com/johnrcarty/budget-assistant). The existing deployment, PostgreSQL data, and bank credentials have not been changed or migrated. The prior app remains available in its repository history.

## Run on the Pi

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
npm --prefix frontend ci
npm --prefix frontend run build
./scripts/run.sh
```

Open `http://PI_ADDRESS:8099`. On the first visit, create a household and its first administrator. There is no default username or password. The server uses `data/budget.sqlite3` and a randomly generated `data/app-secret`. Back up the **entire data directory**, including the secret, to retain encrypted bank connections. Stop the process before copying SQLite files, or use SQLite's backup API. Keep backups private.

For a synthetic preview, start with `BUDGET_DEMO=1 ./scripts/run.sh` and choose **Explore the sample household**. Demo data is stored in a separate `budget-demo.sqlite3`; real bank connections are disabled in demo mode. Do not enable demo on a production installation.

For live development, run `./scripts/dev.sh`: React runs on port 5173, the Python API on 8000, with a Vite API proxy and automatic reload. The shell scripts use exported environment variables; `.env.example` documents them, and Docker Compose reads `.env` automatically. Standalone login should be served over HTTPS before remote use.

```bash
cp .env.example .env
docker compose up -d --build
```

Compose binds localhost by default; set `BUDGET_BIND_ADDRESS=0.0.0.0` for LAN access. A separate local preview has been installed and verified through Home Assistant ingress; see [home-assistant/README.md](home-assistant/README.md) for packaging and updates.

## Budget and privacy

- Household members can read and edit the household budget, bills, transactions, and accounts.
- Each member has a personal scope. Only that member can access its items, accounts, transactions, and bills, including through direct API requests.
- Personal totals are private by default. An owner may share monthly income, planned amounts, and spending totals. These totals are added to the household picture, while categories and individual records stay private.
- A month has named expected income and editable budget purposes grouped into categories. Copying a month copies expense plans and undated manual income, with independent items in the destination month. Scheduled income is calculated from the destination month's actual paydays; dated one-time income and transactions stay in their original month.
- Money is stored as integer cents. Transactions use positive amounts for inflows and negative amounts for outflows. Categorized positive transactions reduce spending as refunds.
- Expected income is the amount you enter for planning; imported deposits do not automatically replace that plan. Uncategorized outflows count toward total spending and remain visible in the transaction inbox.
- Budgets and bill totals currently use USD. Non-USD bank account balances are retained with their currency; their transactions are skipped with a warning to prevent mixing currencies.

The Home Assistant automation token exposes **household bill counts and amounts only**. It cannot access bill names, personal bills, budgets, or transactions. Local user JWTs cannot authenticate to the automation endpoint; automation tokens cannot authenticate to user endpoints.

## Income and pay schedules

In Budget, use **Add income** to name each income source and enter its net amount. Scheduling is optional: manual income can be an undated monthly line or have a date for a one-time payment. Existing monthly totals are kept as editable income lines. When entering a replacement breakdown, select **Replace previous monthly total** explicitly to avoid counting that total twice.

Weekly and every-two-weeks schedules use an anchor payday and continue across month boundaries. A month with five weekly or three biweekly paydays includes all of them. Twice-monthly schedules let you choose two days, including **Last day**; monthly schedules keep the original calendar day and clamp it in shorter months. Schedules follow calendar dates, without automatic bank-holiday or weekend adjustments.

Select an individual payday to change its expected name, amount, or date. Enter zero to skip its amount, or restore it to the schedule later. Editing or stopping a schedule takes effect next month by default; you may choose the current or a future month. Earlier months and adjusted payments are preserved. Planned income stays separate from imported bank deposits.

Personal income sources, schedules, and paydays remain private. Choosing to share personal totals adds only the summed monthly income to the household view.

## Bills and Home Assistant

Bills have a due date, an amount, a paid confirmation, an optional monthly recurrence, and an autopay reminder flag. Autopay does not automatically mark a bill paid. Bank transactions also do not automatically confirm bill payments.

The household's IANA timezone determines the calendar date. The four unpaid buckets are disjoint:

| Bucket | Dates |
| --- | --- |
| Past due | Before today |
| Today | Today |
| This week | Tomorrow through Sunday |
| Next week | Next Monday through Sunday |

Combine today and this-week counts when an automation needs all bills due before the end of the week. Monthly occurrences retain paid history, preserve the original day of the month, and clamp it in shorter months. Missed payments remain overdue while subsequent occurrences are generated for the upcoming calendar window.

Editing a monthly bill updates future unpaid occurrences; other paid occurrences keep their original values. Removing a monthly bill removes that selected occurrence and cancels future unpaid reminders, while keeping other past and paid records. Changing recurrence to none stops future reminders.

In Settings, create a Home Assistant integration token and copy it into HA secrets. Rotating the token invalidates the old one. The endpoint is `GET /api/ha/bills`. A sample REST sensor configuration and prospective ingress packaging are in [home-assistant/README.md](home-assistant/README.md).

Ingress mode accepts the official HA user identity headers only from the configured **actual socket peer**, default `172.30.32.2`. Uvicorn must run with `--no-proxy-headers`. Standalone mode uses expiring JWT username/password login. Optional local fallback can be explicitly enabled in ingress mode with `BUDGET_LOCAL_AUTH=true`. HA users receive separate personal scopes; the first app user bootstraps the household administrator.

## SimpleFIN

Select the destination scope, then connect in Settings using a setup token from [SimpleFIN Bridge](https://bridge.simplefin.org/simplefin/create). All accounts returned by that connection are imported into the selected scope, so use a suitably restricted Bridge token for private accounts. The setup token is claimed once; the resulting access URL is encrypted at rest and never returned by the API.

Refreshes request the v2 feed with verified HTTPS, an initial lookback shorter than 90 days, and a five-day overlap afterward. Scheduled syncs run every six hours by default. Manual refreshes are limited to once per hour per scope. Transient errors remain visible and do not stop later scheduled attempts. Institution warnings appear in Settings. An institution requiring authentication must be repaired in Bridge.

Accounts can be renamed and classified after import. Categorization and account classifications survive refreshes; deleted imported transactions stay deleted, and manual transaction amount corrections survive subsequent imports. These are useful when a bank feed supplies an incorrect sign. Imports are atomic and idempotent, using connection/account/transaction identifiers to avoid duplicates.

See the [SimpleFIN protocol](https://www.simplefin.org/protocol.html) and [Bridge developer guide](https://beta-bridge.simplefin.org/info/developers).

## Verify

```bash
.venv/bin/python -m pytest tests -q
npm --prefix frontend run build
```

Tests use temporary databases, including authentication, personal access, aggregate sharing, token isolation, bill date boundaries, recurrence, and mocked SimpleFIN feeds. Real bank credentials are not needed for testing.

## Scope of this rebuild

The first version covers budgets, household membership, private personal scopes, optional aggregate sharing, a cash-flow Sankey, bill tracking, account management, transaction categorization, scheduled SimpleFIN imports, standalone authentication, and ingress preparation. Original debt-payoff simulation, annual income forecasting, CSV import, advanced categorization rules, and live-data migration are separate follow-up work. No existing data has been copied into the new app.
