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

**Already loaded:** John's 14 Nelnet loans (statement of 2026-07-21, groups
AA–AN, total $69,671.94) are the script's built-in default data set.

**To load the second set (e.g. Natasha's) from a statement PDF:**

1. From the servicer's "My Loans / Account Details" page or PDF, extract per
   loan (Nelnet calls them "Groups": AA, AB, …):
   - **Interest Rate** (e.g. `5.600%` → `aprBps: 560` — basis points, rate × 100)
   - **Outstanding Balance** — use the servicer's outstanding balance, which is
     *principal + unpaid accrued interest*, NOT just principal
     (e.g. `$4,493.42` → `outstandingBalanceCents: 449342`)
   - The statement's as-of date (`asOfDate: "YYYY-MM-DD"`)
   - A name, conventionally `"<Servicer> <Group> — <Loan Type>"`
2. Sanity check: the sum of the per-loan outstanding balances must equal the
   statement's account-level "Current Balance" to the cent.
3. Write them to a JSON array of
   `{ name, outstandingBalanceCents, aprBps, asOfDate }` and run:

   ```bash
   npx tsx --env-file=.env.local scripts/seed-student-loans.ts <householdId> \
     --group "Student Loans — Natasha" --file natasha-loans.json
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
