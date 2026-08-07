import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { applyRulesToUncategorized, applyRuleToMatching } from "@/server/lib/categorize";
import {
  budgetLineItems,
  categoryGroups,
  lineItemTemplates,
  transactions,
} from "@/server/db/schema";
import { getTestDb, type TestDb } from "../../../tests/helpers/pglite";
import {
  seedAccount,
  seedHousehold,
  seedRule,
  seedTransaction,
} from "../../../tests/helpers/seed";

vi.mock("@/server/db/client", async () => {
  const { createTestDb } = await import("../../../tests/helpers/pglite");
  return { db: await createTestDb() };
});

let db: TestDb;
beforeAll(() => {
  db = getTestDb();
});

async function seedExpenseTarget(householdId: string, name = "Groceries") {
  const [group] = await db
    .insert(categoryGroups)
    .values({ householdId, name: "Food" })
    .returning();
  const [template] = await db
    .insert(lineItemTemplates)
    .values({ householdId, categoryGroupId: group.id, name })
    .returning();
  return template;
}

const categoryNameOf = async (transactionId: string) => {
  const [row] = await db
    .select({ name: budgetLineItems.name })
    .from(transactions)
    .innerJoin(budgetLineItems, eq(transactions.budgetLineItemId, budgetLineItems.id))
    .where(eq(transactions.id, transactionId));
  return row?.name ?? null;
};

// A forceInflow rule carries no categorization target - it exists purely to
// correct the sign at sync time. If it reached findMatchingRule it would win
// on priority and then do nothing, silently swallowing the transaction.
describe("action-only rules don't shadow categorization", () => {
  it("a higher-priority forceInflow rule still lets a targeted rule categorize", async () => {
    const household = await seedHousehold(db);
    const account = await seedAccount(db, household.id);
    const template = await seedExpenseTarget(household.id);

    await seedRule(db, household.id, {
      pattern: "PROGRESSIVE",
      matchType: "contains",
      forceInflow: true,
      priority: 1, // runs first
    });
    await seedRule(db, household.id, {
      pattern: "PROGRESSIVE",
      matchType: "contains",
      lineItemTemplateId: template.id,
      priority: 50,
    });

    const tx = await seedTransaction(db, household.id, account.id, {
      description: "DIRECT DEPOSIT PROGRESSIVE PAYROLL (Cash)",
      amountCents: 266953,
      postedDate: "2026-08-05",
    });

    const result = await applyRulesToUncategorized(household.id);

    expect(result.matched).toBe(1);
    expect(await categoryNameOf(tx.id)).toBe("Groceries");
  });

  it("a household with only action-only rules categorizes nothing and doesn't throw", async () => {
    const household = await seedHousehold(db);
    const account = await seedAccount(db, household.id);
    await seedRule(db, household.id, {
      pattern: "PROGRESSIVE",
      matchType: "contains",
      forceInflow: true,
    });
    const tx = await seedTransaction(db, household.id, account.id, {
      description: "DIRECT DEPOSIT PROGRESSIVE PAYROLL (Cash)",
      amountCents: 266953,
      postedDate: "2026-08-05",
    });

    const result = await applyRulesToUncategorized(household.id);

    expect(result.matched).toBe(0);
    expect(await categoryNameOf(tx.id)).toBeNull();
  });

  it("reapplying an action-only rule is a no-op rather than an error", async () => {
    const household = await seedHousehold(db);
    const account = await seedAccount(db, household.id);
    const rule = await seedRule(db, household.id, {
      pattern: "PROGRESSIVE",
      matchType: "contains",
      forceInflow: true,
    });
    await seedTransaction(db, household.id, account.id, {
      description: "DIRECT DEPOSIT PROGRESSIVE PAYROLL (Cash)",
      amountCents: 266953,
      postedDate: "2026-08-05",
    });

    expect(await applyRuleToMatching(household.id, rule.id)).toEqual({
      matched: 0,
      scanned: 0,
    });
  });
});
