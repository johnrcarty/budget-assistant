// One-time data repair for Fidelity's sign-inverted deposits.
//
// SimpleFin's Fidelity feed reports deposit-class INFLOWS (payroll direct
// deposits, 401k contributions) with a negative amount, while signing its
// outflows and interest credits correctly. The fix in code is a
// `forceInflow` categorization rule applied at sync time
// (src/server/jobs/simplefin-sync.ts), but rows already stored - and rows
// now outside SimpleFin's 3-day re-sync overlap, which will never be
// re-fetched - need repairing once.
//
// This script:
//   1. Creates the household's forceInflow rules if they're missing.
//   2. Re-derives amountCents from rawPayload.amount for every stored
//      SimpleFin transaction those rules match.
//   3. Deletes CSV-imported rows that duplicate a now-corrected SimpleFin
//      row (same account, date, description and amount) - during the sign
//      bug a paycheck could be booked twice, once per source, netting to $0.
//
// Idempotent: re-running finds nothing to do. Dry-run by default.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/fix-fidelity-inverted-signs.ts <householdId>
//   npx tsx --env-file=.env.local scripts/fix-fidelity-inverted-signs.ts <householdId> --apply
import { and, eq } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { accounts, categorizationRules, transactions } from "../src/server/db/schema";
import { deleteTransactionById } from "../src/server/db/queries/transactions";
import { dollarsToCents, formatCents } from "../src/server/lib/money";
import { transactionMatchesRule, type RuleMatchType } from "../src/lib/rule-match";

// Scoped to an account AND a specific description on purpose: Fidelity signs
// its outflows correctly, so a broad pattern would flip real purchases into
// income. "PROGRESSIVE" alone would also catch a Progressive insurance
// payment.
const RULES: {
  accountName: string;
  pattern: string;
  matchType: RuleMatchType;
}[] = [
  {
    accountName: "Fidelity Checking",
    pattern: "DIRECT DEPOSIT PROGRESSIVE",
    matchType: "starts_with",
  },
  { accountName: "John 401k", pattern: "contribution", matchType: "exact" },
  { accountName: "Natasha 401k", pattern: "contribution", matchType: "exact" },
];

// Returns the rules that WILL be in effect - including ones a dry run only
// reports, so the sign preview below reflects the end state either way.
async function ensureRules(householdId: string, apply: boolean) {
  const localAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.householdId, householdId));
  const byName = new Map(localAccounts.map((a) => [a.name, a.id]));

  const existing = await db
    .select()
    .from(categorizationRules)
    .where(
      and(
        eq(categorizationRules.householdId, householdId),
        eq(categorizationRules.isActive, true),
        eq(categorizationRules.forceInflow, true),
      ),
    );
  const effective = [...existing];

  for (const spec of RULES) {
    const accountId = byName.get(spec.accountName);
    if (!accountId) {
      console.log(`SKIP rule - no account named "${spec.accountName}" in this household`);
      continue;
    }
    const already = existing.find(
      (r) =>
        r.accountId === accountId &&
        r.pattern === spec.pattern &&
        r.matchType === spec.matchType,
    );
    if (already) {
      console.log(`OK   rule exists: "${spec.pattern}" on ${spec.accountName}`);
      continue;
    }
    console.log(
      `${apply ? "ADD " : "WOULD ADD"} rule: ${spec.matchType} "${spec.pattern}" on ${spec.accountName} → force inflow`,
    );
    const values = {
      householdId,
      accountId,
      pattern: spec.pattern,
      matchType: spec.matchType,
      forceInflow: true,
      priority: 100,
    };
    if (apply) {
      const [created] = await db.insert(categorizationRules).values(values).returning();
      effective.push(created);
    } else {
      effective.push({ ...values, amountCents: null } as (typeof existing)[number]);
    }
  }
  return effective;
}

// Identity a CSV row and a synced row would share once signs agree.
const dupeKey = (r: {
  accountId: string;
  postedDate: string;
  amountCents: number;
  description: string;
}) => `${r.accountId}|${r.postedDate}|${r.amountCents}|${r.description}`;

// Re-derives the stored amount from the feed's own payload, so this stays
// correct even if a row was hand-edited in the meantime. Returns the
// post-correction dupeKeys of the rows it touched, so the duplicate sweep
// below can stay scoped to damage this bug actually caused - and works in
// dry-run mode, where the corrected amounts aren't in the db yet.
async function fixSigns(
  householdId: string,
  rules: { pattern: string; matchType: RuleMatchType; accountId: string | null; amountCents: number | null }[],
  apply: boolean,
): Promise<Set<string>> {
  if (rules.length === 0) {
    console.log("No forceInflow rules - nothing to backfill.");
    return new Set();
  }

  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(eq(transactions.householdId, householdId), eq(transactions.source, "simplefin")),
    );

  const correctedKeys = new Set<string>();
  let fixed = 0;
  for (const row of rows) {
    const matched = rules.some((rule) => transactionMatchesRule(row, rule));
    if (!matched) continue;

    const rawAmount = (row.rawPayload as { amount?: string } | null)?.amount;
    const corrected =
      rawAmount != null ? Math.abs(dollarsToCents(rawAmount)) : Math.abs(row.amountCents);
    correctedKeys.add(dupeKey({ ...row, amountCents: corrected }));
    if (corrected === row.amountCents) continue;

    console.log(
      `${apply ? "FIX " : "WOULD FIX"} ${row.postedDate} "${row.description}" ${formatCents(row.amountCents)} → ${formatCents(corrected)}`,
    );
    if (apply) {
      await db
        .update(transactions)
        .set({ amountCents: corrected, updatedAt: new Date() })
        .where(eq(transactions.id, row.id));
    }
    fixed += 1;
  }
  console.log(`${fixed} transaction(s) ${apply ? "corrected" : "would be corrected"}.`);
  return correctedKeys;
}

// A CSV backfill and the feed can both carry the same paycheck under
// different externalIds, so the unique (accountId, source, externalId)
// constraint never deduped them - and while the signs disagreed the pair was
// undetectable AND netted to $0 in the budget. Now that signs match, drop the
// CSV side. deleteTransactionById also records a tombstone, so re-importing
// the same CSV can't bring the duplicate back.
//
// Deliberately scoped to rows the sign fix touched: the CSV backfill overlaps
// the feed's first sync by a few days, so unrelated CSV/feed duplicate pairs
// exist too. Those predate this bug and are reported, not deleted - cleaning
// them up is a separate decision.
async function dropCsvDuplicates(
  householdId: string,
  correctedKeys: Set<string>,
  apply: boolean,
) {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.householdId, householdId));

  const syncedKeys = new Set(
    rows.filter((r) => r.source === "simplefin").map((r) => dupeKey(r)),
  );

  let dropped = 0;
  let unrelated = 0;
  for (const row of rows) {
    if (row.source !== "csv_import") continue;
    const key = dupeKey(row);

    if (correctedKeys.has(key)) {
      console.log(
        `${apply ? "DROP" : "WOULD DROP"} duplicate CSV row ${row.postedDate} "${row.description}" ${formatCents(row.amountCents)}`,
      );
      if (apply) await deleteTransactionById(householdId, row.id);
      dropped += 1;
    } else if (syncedKeys.has(key)) {
      unrelated += 1;
    }
  }
  console.log(`${dropped} duplicate CSV row(s) ${apply ? "removed" : "would be removed"}.`);
  if (unrelated > 0) {
    console.log(
      `\nNOTE: ${unrelated} other CSV row(s) also duplicate a synced row. They're\n` +
        `unrelated to this sign bug (CSV backfill overlapping the feed's first\n` +
        `sync) and were left alone. Review them separately.`,
    );
  }
}

async function main() {
  const [householdId, ...flags] = process.argv.slice(2);
  if (!householdId) {
    console.error(
      "Usage: npx tsx --env-file=.env.local scripts/fix-fidelity-inverted-signs.ts <householdId> [--apply]",
    );
    process.exit(1);
  }
  const apply = flags.includes("--apply");
  if (!apply) console.log("DRY RUN - pass --apply to write changes.\n");

  const rules = await ensureRules(householdId, apply);
  console.log("");
  const correctedKeys = await fixSigns(householdId, rules, apply);
  console.log("");
  await dropCsvDuplicates(householdId, correctedKeys, apply);

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
