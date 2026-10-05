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
- A month has named expected income and editable budget purposes grouped into categories. Copying a month copies expense plans and undated manual income into new monthly item rows. Copied items share a history identity, while planned amounts and paid confirmations remain specific to each month. Scheduled income is calculated from the destination month's actual paydays; dated one-time income and transactions stay in their original month.
- Money is stored as integer cents. Transactions use positive amounts for inflows and negative amounts for outflows. Categorized positive transactions reduce spending as refunds.
- Expected income is the amount you enter for planning; imported deposits do not automatically replace that plan. Uncategorized outflows count toward total spending and remain visible in the transaction inbox.
- Budgets and bill totals currently use USD. Non-USD bank account balances are retained with their currency; their transactions are skipped with a warning to prevent mixing currencies.

The Home Assistant automation token exposes **household bill counts and amounts only**. It cannot access bill names, personal bills, budgets, or transactions. Local user JWTs cannot authenticate to the automation endpoint; automation tokens cannot authenticate to user endpoints.

## Budget categories

Every household and personal budget starts with **Saved** as its first category, including months with no items. The app creates and keeps this category active automatically. Add your own items inside Saved; the category itself cannot be renamed or archived. An existing category named Saved is retained with its items and history.

Use **Add category** at the bottom of the category list for other categories, then **Add item** inside a category. Categories are stored independently of monthly items, so an empty category remains available after a refresh or in another month.

Edit a category to rename it, change its color, or archive it. Archived categories remain in the stored list and can be reactivated. Archiving preserves their budget items, transactions, and planned totals; existing items stay editable, while adding or moving items into an archived category requires reactivation. Copying a month retains the source plan and category associations, including archived categories with existing items.

Existing group names are carried over automatically, separately for household and personal budgets. Personal category details remain private even when their owner shares aggregate totals. Transaction categorization continues to select a budget item inside a category.

## Budget item details

Tap an item in Budget to open its details from the right. The panel shows the selected month's plan and spending, paid confirmation, linked transactions, and a bar chart for the trailing twelve months ending in the selected month. History uses recorded transactions, includes pending amounts consistently with the budget totals, and treats positive categorized transactions as refunds. Months without spending remain visible.

Due dates sit beside the item name when there is enough room. Otherwise, the complete due-date label moves below the name without splitting across lines. A long label is truncated visually with the full dates available in the row's accessible label and item details.

A due date is optional. Choose a monthly calendar day or the last day of the month; a day such as the 31st clamps in February and returns to the 31st in March. The schedule carries across copied budgets and uses the same bill occurrences as the Bills page and Home Assistant unpaid buckets. An existing bill can be linked explicitly instead of creating another reminder. Paid confirmations apply to one month and remain separate from transaction categorization.

Paid confirmation also works without a due date. Schedule changes take effect from the selected budget month forward. Removing a due schedule stops upcoming unpaid reminders while retaining overdue debt and paid history. Removing the final monthly plan for an item stops its future reminders; deleting one monthly plan leaves the schedule running when other copied plans remain. Linked reminders are managed through the budget item's panel; their paid status can also be changed in Bills.

Link a transaction already in the selected month's scope, or record one from the panel. Reassigning a transaction from another item requires explicit confirmation. Unlinking retains the transaction and its bank identifiers and amount corrections. Budget item amounts use USD; transaction linking rejects accounts in other currencies.

History follows the stable identity retained when an item is copied, including later name changes. Older monthly items start with separate identities because previous releases did not record which item was copied; migration preserves their IDs and transaction associations instead of guessing relationships from matching names.

## Income and pay schedules

In Budget, use **Add income** to name each income source and enter its net amount. Scheduling is optional: manual income can be an undated monthly line or have a date for a one-time payment. Existing monthly totals are kept as editable income lines. When entering a replacement breakdown, select **Replace previous monthly total** explicitly to avoid counting that total twice.

Weekly and every-two-weeks schedules use an anchor payday and continue across month boundaries. A month with five weekly or three biweekly paydays includes all of them. Twice-monthly schedules let you choose two days, including **Last day**; monthly schedules keep the original calendar day and clamp it in shorter months. Schedules follow calendar dates, without automatic bank-holiday or weekend adjustments.

Select an individual payday to change its expected name, amount, or date. Enter zero to skip its amount, or restore it to the schedule later. Editing or stopping a schedule takes effect next month by default; you may choose the current or a future month. Earlier months and adjusted payments are preserved. Planned income stays separate from imported bank deposits.

Personal income sources, schedules, and paydays remain private. Choosing to share personal totals adds only the summed monthly income to the household view.

Open a positive transaction and assign it to an existing income line or scheduled payday, or create a one-time income line when none exists. Split deposits can link to the same payday. Expected amounts and schedule dates remain unchanged; the income section shows posted receipts separately from pending deposits. A deposit received near a month boundary can be linked to the paycheck's expected month. Receipt totals are attributed to that planned income line while the transaction retains its actual bank date.

Moving an expense or another paycheck assignment requires explicit confirmation. A transaction cannot be assigned to both income and a budget item. Unlink receipts before deleting an income line; editing or stopping a schedule preserves entries with receipts. Invalidated bank receipts remain visible for review without counting as received income. A linked receipt that changes to a negative USD amount counts as an outflow until corrected; amounts belonging to a non-USD or unavailable account cannot enter USD budget totals. Personal receipt details stay within their owner's scope.

## Annual income tracker

**More → Income tracker** keeps the yearly taxable/gross-income history separate from monthly budget income and paycheck receipts. Add people without creating login users, then record one or more sources for each person and year, including optional federal, state, local, Medicare, and Social Security withholdings and notes. Archiving a person retains their income history and saved forecasts. Household records are shared; personal records stay within their owner's scope.

The default view ends at the current year in your configured time zone. Choose a saved forecast to compare the actual amounts now recorded against a prediction made from an earlier base year. **Future projections** extends the view through that forecast's horizon; **By year** and **Running total** switch the measure. Missing actual years remain unknown, and actual chart paths stop at recorded values instead of falling to zero when projected years begin. A recorded zero is a real observation. Coverage and missing years remain visible; recorded amounts are not automatically annualized.

New forecasts use either the original repeating percentage-growth model or a linear fit through the actual years at or before the chosen base year. Creation saves the projected points and their historical input baseline permanently. Later income corrections or new years do not rewrite those points. Create another forecast to capture a new prediction. Preview and save are bound to the same inputs, so changed history requires a fresh preview.

The old app stored forecast points but did not preserve its training baseline. Import retains the exact original projected points and marks the reconstructed running-total baseline as coming from the imported historical records. It does not claim those records are the original inputs as they stood when that forecast was created.

**Import** accepts a versioned annual-income JSON snapshot or a USD CSV. JSON preserves people, distinct entry IDs, notes, withholdings, timestamps, and complete forecast vintages. Review the import and resolve any existing person names before applying it. Imports retain existing local edits, reject conflicting source records, and use source IDs to prevent repeat imports from creating duplicates. **Export** downloads only the selected scope's annual tracker data.

CSV accepts a long format such as `Year,Person,Source,Amount,Federal,State,Note`, or a wide spreadsheet such as `Year,Person A,Person B,Total`. Amounts are dollars with at most two decimal places; quote amounts containing commas. Blank wide cells remain unknown, while `0` records zero income. The `Total` column is excluded from wide imports. Tax withholdings require the long format so a shared tax value cannot be counted once per person. Separate identical income rows retain separate identities. An exact-file reimport is protected; a modified CSV is a new source and can overlap earlier records, so use JSON for migrating the old app's saved data and forecasts.

### Move the old annual history without changing the old database

Download the old app's **More → Backup** PostgreSQL backup and restore it into an isolated temporary PostgreSQL instance. If necessary, apply the old app's migrations to that copy through migration 0016; the exporter requires the UUID person schema and rejects older text-person layouts instead of guessing identities. Select the legacy household UUID explicitly, then run from this repository:

```sh
psql -X -q -v household_id=SELECTED_UUID -f scripts/export-legacy-income.sql \
  --output=annual-income.json ISOLATED_DATABASE
```

Use your existing PostgreSQL service or local socket configuration for the isolated database. The export script runs a read-only, repeatable-read transaction and selects only people, annual entries, and saved forecast metadata/points from that household. It preserves exact integer cents, zeroes, nulls, notes, timestamps, and source UUIDs. It exports no login, bank connection, monthly budget, or transaction records. Import the resulting JSON into the intended household or personal scope, then compare record counts, yearly/person totals, and saved forecasts before retiring the original storage. Keep backups and exported financial data outside Git.

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

Bank-specific handlers annotate unusual provider bookkeeping separately from ordinary activity. The first handler identifies Fidelity's positive **Redemption from core account** and negative **Purchase into core account** records using actual institution metadata and literal descriptions. These records are kept as bank transfers, excluded from budget spending, income receipts, and expense rules, and available through **Show transfers** in Transactions. A matching amount alone does not classify a transfer; the real purchase or withdrawal remains ordinary. Existing explicit income and expense assignments and manual amount corrections are preserved. After a sync confirms the institution, handlers also check that account's saved imported records outside the normal overlap. Older records with manual amount corrections remain unchanged because the original bank sign is no longer available; review their treatment manually when needed.

Transaction details allow an explicit ordinary/transfer choice or a return to provider handling. Clear an expense assignment or unlink income before making a transaction a transfer. Additional banks can be supported by adding a named handler and mocked fixtures in `backend/bank_handlers.py`, leaving the generic importer and original provider records intact. Fidelity documents its core position's role in [processing cash and automatically funding debits](https://www.fidelity.com/trading/faqs-about-account).

See the [SimpleFIN protocol](https://www.simplefin.org/protocol.html) and [Bridge developer guide](https://beta-bridge.simplefin.org/info/developers).

## Automatic transaction categorization

Open **Rules** in Transactions to add a description rule, or use **Create rule** while adding or editing a transaction. Match text with **Contains this text** or **Exact description**, choose the budget item, and optionally restrict the rule to one account or money direction. Matching ignores letter case. Active rules run in priority order; move specific rules above broader ones.

Rules run when eligible transactions sync and when you record a transaction with **Use rules automatically**. They follow the budget item's identity into copied months and use the item in the transaction's own month. If that month's item is missing or its category is archived, the transaction stays uncategorized. Rules do not create budget items or mark bills paid.

Saving a rule does not change existing transactions immediately. Use **Preview** for the selected month, review the proposed assignments and skipped matches, then apply them. If the rules or transactions change after previewing, refresh the preview before applying. Rule changes, disabling, and deletion preserve earlier assignments.

Manual category choices are kept, including choosing **Uncategorized** deliberately. Older uncategorized records have no recorded manual choice and remain eligible for rules. Use **Use rules instead** on an uncategorized transaction to release a manual choice. Changing other transaction details preserves its categorization. Rules belong to the selected Home or Personal scope; personal rules and matches remain private even when personal totals are shared.

## Accounts, debts, and balance history

Accounts use compact rows grouped into Assets and Debts, with separate totals for each currency. Tap a row for its details and balance history. Paid-off loans remain accessible in an expandable list; zero-balance credit cards stay in the ordinary debt list. Mobile row actions reveal editing and archiving, and the overall balance history sits below the account list in an expandable section.

The transaction inbox shows checking, savings, and credit-card activity in a compact date-grouped list. Investment, mortgage, and other account transactions remain stored for their existing associations and totals. Account classifications can be corrected in Accounts and survive bank refreshes. Manual entries without an account remain visible.

All account types contribute to balance tracking. Each account retains recorded balance observations, and net worth uses assets minus the absolute balances of credit and loan accounts. Currencies have separate histories and are never added together. Tracking starts with the balances already present when this version is installed; it does not reconstruct earlier balances from transactions. Bank measurement dates are retained separately from import times. An initial cached balance with an unknown bank date stays in the observation record but yields to an accepted dated bank balance in the chart. Incomplete account coverage is marked instead of treating unknown balances as zero. Account updates and bank refreshes record new observations, while editing a name or debt terms does not invent a balance change.

Debt accounts can store their type, original balance, APR, opening date, term, notes, and an optional payment schedule. Enter the amount per payment, choose weekly, every two weeks, twice monthly, or monthly, and choose the anchor date or calendar days. Scheduling follows calendar dates without holiday or weekend adjustments. USD payment schedules generate a **Managed debt** section in Budget, with the actual payments falling in that month, including three-payment biweekly months. Configure these plans through the debt account; the generated budget items cannot be renamed, moved, deleted, or copied as ordinary category items.

Debt details also support collateral. Link an existing asset account or create a property, vehicle, or other asset with its current value. The asset must belong to the same household or personal scope and use the debt's currency. Assets appear independently in the balance sheet and contribute to net worth once, even when several loans are linked to the same asset. The asset's equity subtracts the balances of all its active linked debts. Choose the existing asset when it is already listed in Accounts to avoid recording its value twice.

Edit the asset's value through its account details; each value change becomes a balance observation in its own history and net-worth history. Linking or changing a relationship does not invent an earlier valuation. Paying a loan down to zero, unlinking it, or archiving the loan leaves the asset and its recorded history intact. A zero balance does not automatically stop a debt payment schedule; stop future scheduled payments explicitly when appropriate.

Scheduled debt payments also appear in Bills and the existing household unpaid reminders. Confirm each payment separately; linking a transaction does not automatically mark a payment paid. Schedule edits start next month by default; you may choose the current or a future month. Earlier paid and overdue occurrences remain recorded, and incompatible current-month cadence changes are blocked when they would duplicate retained payments. Transaction links and item history remain available from the managed budget item. When setting up a schedule for a debt already entered as a manual budget item or bill, remove the duplicate manual plan explicitly.

Removing an account archives it so its earlier balance observations and transaction associations remain available to history. Archived bank accounts stay hidden on subsequent imports. Personal account balances, debt terms, payment schedules, and history remain private to their owner; sharing personal budget totals exposes only the existing monthly aggregates.

## Student loans and servicer groups

Create a student-loan group for each borrower and servicer, then attach the individual loan accounts. Borrower names are display labels; the selected Home or Personal scope determines who can access the group. Each loan keeps its own balance history, rate, terms, and payment schedule.

Choose which balances to count explicitly. **Individual loans** uses the sum of the child loans; **Servicer total** uses one linked account holding the reported total and excludes the breakdown loans from net worth. The group itself adds no extra balance. The account list shows the source, the entered breakdown, and any difference so a partial breakdown remains visible. Changes in the counting source are recorded from the time you make them, preserving earlier net-worth history. Keep existing counted accounts linked while changing the source, then detach excluded reference accounts afterward if needed; the app rejects a combined change that would leave the former source counting independently.

The group's APR is weighted by the outstanding balances of loans with a recorded rate. Missing rates remain unknown, and an incomplete breakdown is labeled accordingly. Optional reported accrued interest is tracked separately with its reporting date and coverage; it is never added again to the outstanding balance. If a bank balance drops below an older interest report, that report is retained as stale and excluded from the current interest summary.

Payment schedules remain attached to real accounts. Grouping loans does not create another payment or stop existing schedules; check the schedule hint if both the servicer total and child loans have payment plans. Detaching a loan or archiving a group preserves its last net-worth inclusion choice. You can explicitly restore inclusion for an ungrouped account in its details.

## Verify

```bash
.venv/bin/python -m pytest tests -q
node frontend/tests/annual-income-csv.test.mjs
node frontend/tests/annual-income-view.test.mjs
npm --prefix frontend run build
```

Tests use temporary databases, including authentication, personal access, aggregate sharing, token isolation, bill date boundaries, recurrence, and mocked SimpleFIN feeds. Real bank credentials are not needed for testing.

The legacy annual-income exporter tests use a temporary PostgreSQL cluster when the PostgreSQL command-line tools are installed. The cluster has no TCP listener and contains synthetic records only. These tests do not connect to the old app or export its real financial data.

## Scope of this rebuild

The rebuild covers budgets, household membership, private personal scopes, optional aggregate sharing, a cash-flow Sankey, bill tracking, account and debt management, reusable transaction categorization rules, scheduled SimpleFIN imports, standalone authentication, ingress preparation, and annual income history with saved forecasts and reviewed imports. Original debt-payoff simulation and migration of real historical data remain separate follow-up work. No original annual income records have been copied into the new app.
