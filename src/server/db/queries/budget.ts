import { and, asc, desc, eq, isNotNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  budgetMonths,
  categoryGroups,
  budgetLineItems,
  incomeLineItems,
  lineItemTemplates,
} from "@/server/db/schema";
import { getSpentCentsByLineItem, getReceivedCentsByIncomeItem } from "./transactions";
import { addDaysToIsoDate, daysInMonth, shiftMonthString } from "@/lib/month";

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
// Read-only lookup - unlike getOrCreateBudgetMonth, safe to call from
// widgets that must not insert rows as a page-load side effect.
export async function getBudgetMonth(householdId: string, monthDate: string) {
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

  return existing ?? null;
}

export interface UpcomingBill {
  id: string;
  name: string;
  groupName: string;
  dueDate: string;
  plannedAmountCents: number;
  // "month" bills are real budget_line_item instances (linkable); "template"
  // bills are projected from line_item_templates when next month's budget
  // doesn't exist yet.
  source: "month" | "template";
}

export interface UpcomingBills {
  overdue: UpcomingBill[];
  dueToday: UpcomingBill[];
  dueThisWeek: UpcomingBill[];
}

// dueDay is a day-of-month integer; clamp to the month's length so e.g.
// dueDay 31 in September resolves to Sept 30 instead of an invalid date.
function clampedDueDate(month: string, dueDay: number): string {
  const day = Math.min(dueDay, daysInMonth(month));
  return `${month.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}

export async function getUpcomingBills(
  householdId: string,
  today: string,
): Promise<UpcomingBills> {
  const currentMonth = `${today.slice(0, 7)}-01`;
  const windowEnd = addDaysToIsoDate(today, 7);

  const overdue: UpcomingBill[] = [];
  const dueToday: UpcomingBill[] = [];
  const dueThisWeek: UpcomingBill[] = [];

  const addToBucket = (bill: UpcomingBill) => {
    if (bill.dueDate < today) overdue.push(bill);
    else if (bill.dueDate === today) dueToday.push(bill);
    else if (bill.dueDate <= windowEnd) dueThisWeek.push(bill);
  };

  // Returns false when the budget month doesn't exist (caller may fall back
  // to templates). Unpaid = no spend recorded; any spend counts as paid.
  const collectMonthBills = async (monthDate: string): Promise<boolean> => {
    const budgetMonth = await getBudgetMonth(householdId, monthDate);
    if (!budgetMonth) return false;

    const rows = await db
      .select({ item: budgetLineItems, groupName: categoryGroups.name })
      .from(budgetLineItems)
      .innerJoin(categoryGroups, eq(budgetLineItems.categoryGroupId, categoryGroups.id))
      .where(
        and(
          eq(budgetLineItems.budgetMonthId, budgetMonth.id),
          isNotNull(budgetLineItems.dueDay),
        ),
      );

    const spentByItem = await getSpentCentsByLineItem(rows.map((row) => row.item.id));
    for (const row of rows) {
      if ((spentByItem.get(row.item.id) ?? 0) > 0) continue;
      addToBucket({
        id: row.item.id,
        name: row.item.name,
        groupName: row.groupName,
        dueDate: clampedDueDate(monthDate, row.item.dueDay!),
        plannedAmountCents: row.item.plannedAmountCents,
        source: "month",
      });
    }
    return true;
  };

  await collectMonthBills(currentMonth);

  // The 7-day window can spill into next month. Use next month's real budget
  // if it exists; otherwise project from active templates.
  if (windowEnd.slice(0, 7) !== today.slice(0, 7)) {
    const nextMonth = shiftMonthString(currentMonth, 1);
    const hasNextMonth = await collectMonthBills(nextMonth);

    if (!hasNextMonth) {
      const spillDay = Number(windowEnd.slice(8, 10));
      const templates = await db
        .select({ template: lineItemTemplates, groupName: categoryGroups.name })
        .from(lineItemTemplates)
        .innerJoin(
          categoryGroups,
          eq(lineItemTemplates.categoryGroupId, categoryGroups.id),
        )
        .where(
          and(
            eq(lineItemTemplates.householdId, householdId),
            eq(lineItemTemplates.isActive, true),
            isNotNull(lineItemTemplates.dueDay),
            lte(lineItemTemplates.dueDay, spillDay),
          ),
        );

      for (const row of templates) {
        addToBucket({
          id: row.template.id,
          name: row.template.name,
          groupName: row.groupName,
          dueDate: clampedDueDate(nextMonth, row.template.dueDay!),
          plannedAmountCents: row.template.defaultPlannedAmountCents,
          source: "template",
        });
      }
    }
  }

  const byDueDateThenName = (a: UpcomingBill, b: UpcomingBill) =>
    a.dueDate === b.dueDate ? a.name.localeCompare(b.name) : a.dueDate < b.dueDate ? -1 : 1;
  overdue.sort(byDueDateThenName);
  dueToday.sort(byDueDateThenName);
  dueThisWeek.sort(byDueDateThenName);

  return { overdue, dueToday, dueThisWeek };
}

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
    // The app-managed Debt section (auto-created by debt-to-budget linking)
    // always sits at the bottom, regardless of sortOrder.
    .orderBy(
      sql`case when ${categoryGroups.systemKey} = 'debt' then 1 else 0 end`,
      asc(categoryGroups.sortOrder),
    );
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

  const incomeRows = await db
    .select()
    .from(incomeLineItems)
    .where(eq(incomeLineItems.budgetMonthId, budgetMonth.id))
    .orderBy(asc(incomeLineItems.sortOrder));

  const receivedByItem = await getReceivedCentsByIncomeItem(incomeRows.map((i) => i.id));
  const income = incomeRows.map((item) => ({
    ...item,
    receivedCents: receivedByItem.get(item.id) ?? 0,
  }));

  const plannedIncomeCents = income.reduce(
    (sum, i) => sum + i.plannedAmountCents,
    0,
  );
  const receivedIncomeCents = income.reduce((sum, i) => sum + i.receivedCents, 0);
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
    receivedIncomeCents,
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
