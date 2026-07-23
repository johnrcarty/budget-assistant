// One-time data fix for a bug where manually categorizing a transaction
// (via the Edit Transaction dialog or Bulk categorize) linked it to
// whichever month's line-item instance happened to be on screen, instead of
// the transaction's OWN month - e.g. categorizing a May transaction while
// viewing July silently linked it to July's instance. The underlying bug is
// fixed in code; this script re-links already-affected transactions to the
// correct month's instance of the SAME template (never changes what
// category/person a transaction is assigned to, only which month's
// instance it points at).
//
// Usage: npx tsx --env-file=.env.local scripts/fix-mismonthed-categorizations.ts <householdId>
// Get a household id: npx tsx --env-file=.env.local -e
//   'import("./src/server/db/client").then(({db}) => import("./src/server/db/schema").then(({households}) => db.select().from(households).then(console.log)))'
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../src/server/db/client";
import {
  transactions,
  budgetLineItems,
  budgetMonths,
  lineItemTemplates,
  incomeLineItems,
  incomeTemplates,
} from "../src/server/db/schema";
import { ensureLineItemInstance, ensureIncomeInstance } from "../src/server/db/queries/line-item-instances";

async function fixExpenseMisLinks(householdId: string) {
  const rows = await db
    .select({
      txId: transactions.id,
      description: transactions.description,
      postedDate: transactions.postedDate,
      budgetLineItemId: transactions.budgetLineItemId,
      templateItemId: budgetLineItems.templateItemId,
      templateName: lineItemTemplates.name,
      instanceMonth: budgetMonths.month,
    })
    .from(transactions)
    .innerJoin(budgetLineItems, eq(transactions.budgetLineItemId, budgetLineItems.id))
    .innerJoin(budgetMonths, eq(budgetLineItems.budgetMonthId, budgetMonths.id))
    .leftJoin(lineItemTemplates, eq(budgetLineItems.templateItemId, lineItemTemplates.id))
    .where(and(eq(transactions.householdId, householdId), isNotNull(transactions.budgetLineItemId)));

  let fixed = 0;
  let skippedNoTemplate = 0;
  for (const row of rows) {
    const txMonth = `${row.postedDate.slice(0, 7)}-01`;
    if (row.instanceMonth === txMonth) continue;
    if (!row.templateItemId) {
      console.log(
        `SKIP expense (no template, can't determine correct instance): tx=${row.txId} "${row.description}" ${row.postedDate} linked to ${row.instanceMonth} instance`,
      );
      skippedNoTemplate += 1;
      continue;
    }
    const correctInstanceId = await ensureLineItemInstance(householdId, row.templateItemId, txMonth);
    if (!correctInstanceId || correctInstanceId === row.budgetLineItemId) continue;
    await db
      .update(transactions)
      .set({ budgetLineItemId: correctInstanceId, updatedAt: new Date() })
      .where(eq(transactions.id, row.txId));
    console.log(
      `FIXED expense: tx=${row.txId} "${row.description}" (${row.postedDate}) "${row.templateName}" moved ${row.instanceMonth} -> ${txMonth}`,
    );
    fixed += 1;
  }
  return { fixed, skippedNoTemplate, scanned: rows.length };
}

async function fixIncomeMisLinks(householdId: string) {
  const rows = await db
    .select({
      txId: transactions.id,
      description: transactions.description,
      postedDate: transactions.postedDate,
      incomeLineItemId: transactions.incomeLineItemId,
      templateItemId: incomeLineItems.templateItemId,
      templateName: incomeTemplates.name,
      instanceMonth: budgetMonths.month,
    })
    .from(transactions)
    .innerJoin(incomeLineItems, eq(transactions.incomeLineItemId, incomeLineItems.id))
    .innerJoin(budgetMonths, eq(incomeLineItems.budgetMonthId, budgetMonths.id))
    .leftJoin(incomeTemplates, eq(incomeLineItems.templateItemId, incomeTemplates.id))
    .where(and(eq(transactions.householdId, householdId), isNotNull(transactions.incomeLineItemId)));

  let fixed = 0;
  let skippedNoTemplate = 0;
  for (const row of rows) {
    const txMonth = `${row.postedDate.slice(0, 7)}-01`;
    if (row.instanceMonth === txMonth) continue;
    if (!row.templateItemId) {
      console.log(
        `SKIP income (no template, can't determine correct instance): tx=${row.txId} "${row.description}" ${row.postedDate} linked to ${row.instanceMonth} instance`,
      );
      skippedNoTemplate += 1;
      continue;
    }
    // Moves to the SAME template's correct-month instance - deliberately
    // does not re-run slot planning, so a manually-assigned slot doesn't
    // silently move to a different slot as a side effect of this fix.
    const correctInstanceId = await ensureIncomeInstance(householdId, row.templateItemId, txMonth);
    if (!correctInstanceId || correctInstanceId === row.incomeLineItemId) continue;
    await db
      .update(transactions)
      .set({ incomeLineItemId: correctInstanceId, updatedAt: new Date() })
      .where(eq(transactions.id, row.txId));
    console.log(
      `FIXED income: tx=${row.txId} "${row.description}" (${row.postedDate}) "${row.templateName}" moved ${row.instanceMonth} -> ${txMonth}`,
    );
    fixed += 1;
  }
  return { fixed, skippedNoTemplate, scanned: rows.length };
}

async function main() {
  const householdId = process.argv[2];
  if (!householdId) {
    console.error("Usage: npx tsx --env-file=.env.local scripts/fix-mismonthed-categorizations.ts <householdId>");
    process.exit(1);
  }

  const expenseResult = await fixExpenseMisLinks(householdId);
  const incomeResult = await fixIncomeMisLinks(householdId);

  console.log("---");
  console.log(
    `Expense: scanned ${expenseResult.scanned}, fixed ${expenseResult.fixed}, skipped (no template) ${expenseResult.skippedNoTemplate}`,
  );
  console.log(
    `Income: scanned ${incomeResult.scanned}, fixed ${incomeResult.fixed}, skipped (no template) ${incomeResult.skippedNoTemplate}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
