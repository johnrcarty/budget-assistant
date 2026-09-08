import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  applyRulesToUncategorized,
  applyRuleToMatching,
  reapplySignRules,
} from "@/server/lib/categorize";
import {
  budgetLineItems,
  categorizationRules,
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

describe("reapplySignRules", () => {
  const amountOf = async (id: string) => {
    const [row] = await db.select().from(transactions).where(eq(transactions.id, id));
    return row.amountCents;
  };

  async function seedFidelityRows(householdId: string, accountId: string) {
    const purchase = await seedTransaction(db, householdId, accountId, {
      amountCents: 1000,
      description: "DEBIT CARD PURCHASE STARBUCKS (Cash)",
      source: "simplefin",
      externalId: "p-1",
      rawPayload: { amount: "10.00" },
    });
    const payroll = await seedTransaction(db, householdId, accountId, {
      amountCents: -266953,
      description: "DIRECT DEPOSIT PROGRESSIVE PAYROLL (Cash)",
      source: "simplefin",
      externalId: "d-1",
      rawPayload: { amount: "-2669.53" },
    });
    const debit = await seedTransaction(db, householdId, accountId, {
      amountCents: -3000,
      description: "DIRECT DEBIT BANK OF AMERICA (Cash)",
      source: "simplefin",
      externalId: "b-1",
      rawPayload: { amount: "-30.00" },
    });
    const noPayload = await seedTransaction(db, householdId, accountId, {
      amountCents: 500,
      description: "DEBIT CARD PURCHASE LEGACY ROW",
      source: "simplefin",
      externalId: "legacy-1",
      rawPayload: null,
    });
    const csv = await seedTransaction(db, householdId, accountId, {
      amountCents: 700,
      description: "DEBIT CARD PURCHASE FROM CSV",
      source: "csv_import",
      externalId: "csv-1",
    });
    return { purchase, payroll, debit, noPayload, csv };
  }

  it("re-derives every synced row's sign from its raw payload through the current rules", async () => {
    const household = await seedHousehold(db);
    const account = await seedAccount(db, household.id);
    const rows = await seedFidelityRows(household.id, account.id);
    await seedRule(db, household.id, {
      pattern: "DEBIT CARD PURCHASE",
      matchType: "starts_with",
      accountId: account.id,
      forceOutflow: true,
    });
    await seedRule(db, household.id, {
      pattern: "DIRECT DEPOSIT PROGRESSIVE",
      matchType: "starts_with",
      accountId: account.id,
      forceInflow: true,
    });

    const result = await reapplySignRules(household.id);

    expect(result.matched).toBe(2);
    expect(await amountOf(rows.purchase.id)).toBe(-1000);
    expect(await amountOf(rows.payroll.id)).toBe(266953);
    // Unmatched, payload-less, and non-SimpleFin rows are untouched.
    expect(await amountOf(rows.debit.id)).toBe(-3000);
    expect(await amountOf(rows.noPayload.id)).toBe(500);
    expect(await amountOf(rows.csv.id)).toBe(700);

    // Idempotent.
    expect((await reapplySignRules(household.id)).matched).toBe(0);
  });

  it("reverts to the feed's raw sign once the rule is gone", async () => {
    const household = await seedHousehold(db);
    const account = await seedAccount(db, household.id);
    const rows = await seedFidelityRows(household.id, account.id);
    const rule = await seedRule(db, household.id, {
      pattern: "DEBIT CARD PURCHASE",
      matchType: "starts_with",
      accountId: account.id,
      forceOutflow: true,
    });
    await reapplySignRules(household.id);
    expect(await amountOf(rows.purchase.id)).toBe(-1000);

    await db.update(categorizationRules).set({ isActive: false }).where(eq(categorizationRules.id, rule.id));
    await reapplySignRules(household.id);
    expect(await amountOf(rows.purchase.id)).toBe(1000);
  });

  it("applyRuleToMatching on a sign-only rule runs the sign reapply", async () => {
    const household = await seedHousehold(db);
    const account = await seedAccount(db, household.id);
    const rows = await seedFidelityRows(household.id, account.id);
    const rule = await seedRule(db, household.id, {
      pattern: "DEBIT CARD PURCHASE",
      matchType: "starts_with",
      accountId: account.id,
      forceOutflow: true,
    });

    const result = await applyRuleToMatching(household.id, rule.id);

    expect(result.matched).toBe(1);
    expect(await amountOf(rows.purchase.id)).toBe(-1000);
  });
});
