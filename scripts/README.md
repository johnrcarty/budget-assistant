# Scripts

One-off and verification scripts, run with `npx tsx --env-file=.env.local scripts/<name>.ts`.
They bypass the Next.js DAL (which requires a request context) and take an explicit
`householdId` argument. Get the household id with a one-liner:

```bash
npx tsx --env-file=.env.local -e \
  'import("./src/server/db/client.js")' # or query: select id from household;
```

## Loading student loans from a servicer statement (`seed-student-loans.ts`)

Used to load the individual student loans that back the "Student Loans" account
group rollup. Nelnet has no SimpleFin connector, so this is the ingestion path.

The script's built-in default data set is placeholder/example loans for
local dev only — always pass `--file` with a real statement's data (below)
when seeding an actual household.

**To load a household's loans from a statement PDF:**

1. From the servicer's "My Loans / Account Details" page or PDF, extract per
   loan (Nelnet calls them "Groups": AA, AB, …):
   - **Interest Rate** (e.g. `5.600%` → `aprBps: 560` — basis points, rate × 100)
   - **Outstanding Balance** — use the servicer's outstanding balance, which is
     *principal + unpaid accrued interest*, NOT just principal
     (e.g. `$1,234.56` → `outstandingBalanceCents: 123456`)
   - The statement's as-of date (`asOfDate: "YYYY-MM-DD"`)
   - A name, conventionally `"<Servicer> <Group> — <Loan Type>"`
2. Sanity check: the sum of the per-loan outstanding balances must equal the
   statement's account-level "Current Balance" to the cent.
3. Write them to a JSON array of
   `{ name, outstandingBalanceCents, aprBps, asOfDate }` and run:

   ```bash
   npx tsx --env-file=.env.local scripts/seed-student-loans.ts <householdId> \
     --group "Student Loans — <person>" --file loans.json
   ```

The script creates one liability account per loan (kind `loan`, subtype
`student_loan`) under the named account group, plus a manual
`debt_balance_snapshot` and an APR-only `debt_terms_version` per loan.
It refuses to run twice against a non-empty group.

Loans in $0/month forbearance (e.g. SAVE plan) get NO payment fields on their
terms row — deliberately, so the payoff simulator reports "needs terms" instead
of fabricating a payment. When repayment resumes, set each loan's real payment
on its debt detail page (`/accounts/<accountId>`).

To run against the production DB, run the same command on the server inside the
app container (or with `DATABASE_URL` pointed at the prod DB).

## Fixing mis-monthed categorizations (`fix-mismonthed-categorizations.ts`)

One-time data fix for a bug (fixed in code, this script repairs data from
before the fix): manually categorizing a transaction via the Edit
Transaction dialog or Bulk categorize linked it to whichever month's line-
item instance happened to be on screen, not the transaction's own month —
e.g. categorizing a May transaction while viewing July silently linked it
to July's instance instead of May's, inflating that month's category
totals with spending that actually happened elsewhere.

```bash
npx tsx --env-file=.env.local scripts/fix-mismonthed-categorizations.ts <householdId>
```

Re-links every affected transaction to the correct month's instance of the
SAME template/person it was already assigned to — it never changes what
category or person a transaction is assigned to, only which month's
instance it points at. Income transactions move to the correct month's
instance without re-running slot planning, so a manually-assigned slot
can't shift as a side effect. Safe to run more than once (a no-op the
second time). Prints every change it makes.

**Run this once against the production DB after deploying the fix** (same
command, on the server, with `DATABASE_URL` pointed at the prod DB) — the
code fix only stops new mis-links, it doesn't repair ones already made.

## Backup / restore (`scripts/backup/`)

Unlike the scripts above, these are `sh` scripts that run *inside the
`backup` Docker Compose service*, not via `tsx` on the host — they call
`pg_dump`/`pg_restore` directly against the `db` container. See
`docs/backup-restore.md` for the full runbook (scheduled backups, manual
trigger, and the host-migration restore procedure).
