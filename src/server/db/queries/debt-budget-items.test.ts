import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { getProjectedDebtItems } from "@/server/db/queries/debt-budget-items";
import { getBudgetOverview } from "@/server/db/queries/budget";
import { materializeDebtLineItem } from "@/server/db/queries/line-item-instances";
import {
  budgetLineItems,
  budgetMonths,
  categoryGroups,
  lineItemTemplates,
} from "@/server/db/schema";
import { currentMonthString, shiftMonthString } from "@/lib/month";
import { getTestDb, type TestDb } from "../../../../tests/helpers/pglite";
import {
  seedDebtSnapshot,
  seedDebtTerms,
  seedHousehold,
  seedLiabilityAccount,
} from "../../../../tests/helpers/seed";

vi.mock("@/server/db/client", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/pglite");
  return { db: await createTestDb() };
});

let db: TestDb;
beforeAll(() => {
  db = getTestDb();
});

const THIS_MONTH = currentMonthString();
const NEXT_MONTH = shiftMonthString(THIS_MONTH, 1);
const LAST_MONTH = shiftMonthString(THIS_MONTH, -1);

// A liability with terms, linked to the budget through a debt template -
// the state linkDebtToBudget leaves behind.
async function seedLinkedDebt(
  opts: {
    balanceCents?: number;
    templateActive?: boolean;
    accountArchived?: boolean;
    fixedPaymentCents?: number;
    escrowCents?: number;
  } = {},
) {
  const household = await seedHousehold(db);
  const account = await seedLiabilityAccount(db, household.id, {
    name: "Mortgage",
    kind: "loan",
    isArchived: opts.accountArchived ?? false,
    currentBalanceCents: opts.balanceCents ?? 15_000_000,
  });
  await seedDebtTerms(db, account.id, {
    termsType: "installment",
    fixedPaymentCents: opts.fixedPaymentCents ?? 143_300,
    escrowCents: opts.escrowCents ?? 80_000,
    aprBps: 400,
    dueDay: 1,
    paymentFrequency: "monthly",
  });
  await seedDebtSnapshot(db, account.id, {
    asOfDate: "2025-01-02",
    balanceCents: opts.balanceCents ?? 15_000_000,
  });

  const [group] = await db
    .insert(categoryGroups)
    .values({ householdId: household.id, name: "Debt", systemKey: "debt" })
    .returning();
  const [template] = await db
    .insert(lineItemTemplates)
    .values({
      householdId: household.id,
      categoryGroupId: group.id,
      debtAccountId: account.id,
      name: account.name,
      isActive: opts.templateActive ?? true,
    })
    .returning();

  return { household, account, group, template };
}

const projectedNames = async (householdId: string, month: string) =>
  (await getProjectedDebtItems(householdId, month, new Set())).map((i) => i.name);

describe("projected debt items", () => {
  it("projects a linked debt into a month that never stamped it", async () => {
    const { household } = await seedLinkedDebt();

    const items = await getProjectedDebtItems(household.id, NEXT_MONTH, new Set());

    expect(items).toHaveLength(1);
    // Gross payment: principal + interest + escrow is the real cash out.
    expect(items[0]).toMatchObject({
      name: "Mortgage",
      plannedAmountCents: 143_300,
      dueDay: 1,
    });
  });

  it("leaves past months exactly as they were budgeted", async () => {
    const { household } = await seedLinkedDebt();

    expect(await projectedNames(household.id, LAST_MONTH)).toEqual([]);
  });

  it("does not duplicate a debt that already has an instance", async () => {
    const { household, template } = await seedLinkedDebt();

    const items = await getProjectedDebtItems(
      household.id,
      THIS_MONTH,
      new Set([template.id]),
    );

    expect(items).toEqual([]);
  });

  it("excludes a paid-off debt", async () => {
    const { household, account } = await seedLinkedDebt({ balanceCents: 0 });
    await seedDebtSnapshot(db, account.id, { asOfDate: "2025-02-01", balanceCents: 0 });

    expect(await projectedNames(household.id, THIS_MONTH)).toEqual([]);
  });

  it("excludes an archived account", async () => {
    const { household } = await seedLinkedDebt({ accountArchived: true });

    expect(await projectedNames(household.id, THIS_MONTH)).toEqual([]);
  });

  it("excludes a debt unlinked from the budget", async () => {
    const { household } = await seedLinkedDebt({ templateActive: false });

    expect(await projectedNames(household.id, THIS_MONTH)).toEqual([]);
  });
});

describe("budget overview with projected debt", () => {
  it("shows projected rows in the Debt group and counts them as planned", async () => {
    const { household } = await seedLinkedDebt();

    const overview = await getBudgetOverview(household.id, NEXT_MONTH);
    const debtGroup = overview.groups.find((g) => g.systemKey === "debt");

    expect(debtGroup?.items).toHaveLength(1);
    expect(debtGroup?.items[0]).toMatchObject({
      id: null,
      projected: true,
      plannedAmountCents: 143_300,
    });
    expect(overview.plannedExpensesCents).toBe(143_300);
    // Derived debt alone isn't a budget the user planned - the month should
    // still offer to copy the previous one.
    expect(overview.hasBudget).toBe(false);
  });

  it("prefers a stamped row over a projection, without double-counting", async () => {
    const { household, group, template } = await seedLinkedDebt();
    const [month] = await db
      .insert(budgetMonths)
      .values({ householdId: household.id, month: NEXT_MONTH })
      .returning();
    await db.insert(budgetLineItems).values({
      householdId: household.id,
      budgetMonthId: month.id,
      categoryGroupId: group.id,
      templateItemId: template.id,
      name: "Mortgage",
      plannedAmountCents: 138_220,
      dueDay: 1,
    });

    const overview = await getBudgetOverview(household.id, NEXT_MONTH);
    const debtGroup = overview.groups.find((g) => g.systemKey === "debt");

    expect(debtGroup?.items).toHaveLength(1);
    expect(debtGroup?.items[0]).toMatchObject({
      projected: false,
      plannedAmountCents: 138_220,
    });
    expect(overview.plannedExpensesCents).toBe(138_220);
  });
});

describe("materializeDebtLineItem", () => {
  it("creates the instance with the derived amount, not zero", async () => {
    const { household, template } = await seedLinkedDebt();

    const id = await materializeDebtLineItem(household.id, template.id, NEXT_MONTH);

    expect(id).not.toBeNull();
    const [row] = await db
      .select()
      .from(budgetLineItems)
      .where(eq(budgetLineItems.id, id!));
    expect(row).toMatchObject({ plannedAmountCents: 143_300, dueDay: 1 });
  });

  it("is idempotent - opening a projected row twice makes one instance", async () => {
    const { household, template } = await seedLinkedDebt();

    const first = await materializeDebtLineItem(household.id, template.id, NEXT_MONTH);
    const second = await materializeDebtLineItem(household.id, template.id, NEXT_MONTH);

    expect(second).toBe(first);
    const rows = await db
      .select()
      .from(budgetLineItems)
      .where(eq(budgetLineItems.templateItemId, template.id));
    expect(rows).toHaveLength(1);
  });

  it("refuses a template that isn't debt-linked", async () => {
    const { household, group } = await seedLinkedDebt();
    const [plain] = await db
      .insert(lineItemTemplates)
      .values({
        householdId: household.id,
        categoryGroupId: group.id,
        name: "Groceries",
      })
      .returning();

    expect(await materializeDebtLineItem(household.id, plain.id, NEXT_MONTH)).toBeNull();
  });
});
