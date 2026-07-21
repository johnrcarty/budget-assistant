import { and, asc, desc, eq, lt } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  budgetMonths,
  categoryGroups,
  budgetLineItems,
  incomeLineItems,
} from "@/server/db/schema";
import { getSpentCentsByLineItem } from "./transactions";

// Always the 1st of the month - callers pass any date and this normalizes it,
// so "the month" has one canonical representation everywhere.
export function firstOfMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

export async function getOrCreateBudgetMonth(
  householdId: string,
  monthDate: string,
) {
  const [existing] = await db
    .select()
    .from(budgetMonths)
    .where(
      and(
        eq(budgetMonths.householdId, householdId),
        eq(budgetMonths.month, monthDate),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(budgetMonths)
    .values({ householdId, month: monthDate })
    .returning();

  return created;
}

// The most recent earlier month that actually has budget line items in it -
// used both to offer "copy last month's budget" and to do the copy itself.
// Deliberately looks at real prior months' data, not a separate "template"
// concept, so it matches what the user actually had (including one-off
// items), the same way EveryDollar's "We'll copy July's budget" works.
export async function getMostRecentMonthWithBudget(
  householdId: string,
  beforeMonth: string,
) {
  const candidates = await db
    .select()
    .from(budgetMonths)
    .where(
      and(
        eq(budgetMonths.householdId, householdId),
        lt(budgetMonths.month, beforeMonth),
      ),
    )
    .orderBy(desc(budgetMonths.month));

  for (const candidate of candidates) {
    const [hasItems] = await db
      .select({ id: budgetLineItems.id })
      .from(budgetLineItems)
      .where(eq(budgetLineItems.budgetMonthId, candidate.id))
      .limit(1);
    if (hasItems) return candidate;
  }

  return null;
}

// User-initiated only (the "Create <Month> Budget" button) - never runs
// silently on page load. Clones the source month's line items and income
// items as-is, including any one-off items, same as EveryDollar's copy.
export async function copyMonthBudget(
  householdId: string,
  sourceBudgetMonthId: string,
  targetBudgetMonthId: string,
) {
  const sourceItems = await db
    .select()
    .from(budgetLineItems)
    .where(eq(budgetLineItems.budgetMonthId, sourceBudgetMonthId));

  if (sourceItems.length > 0) {
    await db.insert(budgetLineItems).values(
      sourceItems.map((item) => ({
        householdId,
        budgetMonthId: targetBudgetMonthId,
        categoryGroupId: item.categoryGroupId,
        templateItemId: item.templateItemId,
        name: item.name,
        plannedAmountCents: item.plannedAmountCents,
        dueDay: item.dueDay,
        recurrenceRule: item.recurrenceRule,
        isFavorite: item.isFavorite,
        fundTargetCents: item.fundTargetCents,
        sortOrder: item.sortOrder,
      })),
    );
  }

  const sourceIncome = await db
    .select()
    .from(incomeLineItems)
    .where(eq(incomeLineItems.budgetMonthId, sourceBudgetMonthId));

  if (sourceIncome.length > 0) {
    await db.insert(incomeLineItems).values(
      sourceIncome.map((item) => ({
        householdId,
        budgetMonthId: targetBudgetMonthId,
        templateItemId: item.templateItemId,
        name: item.name,
        plannedAmountCents: item.plannedAmountCents,
        sortOrder: item.sortOrder,
      })),
    );
  }
}

export async function getCategoryGroups(householdId: string) {
  return db
    .select()
    .from(categoryGroups)
    .where(
      and(
        eq(categoryGroups.householdId, householdId),
        eq(categoryGroups.isArchived, false),
      ),
    )
    .orderBy(asc(categoryGroups.sortOrder));
}

export async function getBudgetOverview(householdId: string, monthDate: string) {
  const budgetMonth = await getOrCreateBudgetMonth(householdId, monthDate);

  const groups = await getCategoryGroups(householdId);

  const items = await db
    .select()
    .from(budgetLineItems)
    .where(eq(budgetLineItems.budgetMonthId, budgetMonth.id))
    .orderBy(asc(budgetLineItems.sortOrder));

  const spentByItem = await getSpentCentsByLineItem(items.map((i) => i.id));
  const itemsWithSpent = items.map((item) => ({
    ...item,
    spentCents: spentByItem.get(item.id) ?? 0,
  }));

  const income = await db
    .select()
    .from(incomeLineItems)
    .where(eq(incomeLineItems.budgetMonthId, budgetMonth.id))
    .orderBy(asc(incomeLineItems.sortOrder));

  const plannedIncomeCents = income.reduce(
    (sum, i) => sum + i.plannedAmountCents,
    0,
  );
  const plannedExpensesCents = items.reduce(
    (sum, i) => sum + i.plannedAmountCents,
    0,
  );

  const hasBudget = items.length > 0 || income.length > 0;
  const previousMonthWithBudget = hasBudget
    ? null
    : await getMostRecentMonthWithBudget(householdId, monthDate);

  return {
    budgetMonth,
    hasBudget,
    previousMonthWithBudget,
    groups: groups.map((group) => ({
      ...group,
      items: itemsWithSpent.filter((item) => item.categoryGroupId === group.id),
    })),
    income,
    plannedIncomeCents,
    plannedExpensesCents,
    leftToBudgetCents: plannedIncomeCents - plannedExpensesCents,
  };
}

export async function getLineItemDetail(
  householdId: string,
  lineItemId: string,
) {
  const [row] = await db
    .select({
      item: budgetLineItems,
      month: budgetMonths.month,
    })
    .from(budgetLineItems)
    .innerJoin(budgetMonths, eq(budgetLineItems.budgetMonthId, budgetMonths.id))
    .where(
      and(
        eq(budgetLineItems.id, lineItemId),
        eq(budgetLineItems.householdId, householdId),
      ),
    )
    .limit(1);

  return row ?? null;
}
