import { and, asc, desc, eq, isNotNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  budgetMonths,
  categoryGroups,
  budgetLineItems,
  incomeLineItems,
  incomeTemplates,
  lineItemTemplates,
} from "@/server/db/schema";
import { getSpentCentsByLineItem, getReceivedCentsByIncomeItem } from "./transactions";
import { getStampingSchedulePersonIds } from "./income-schedules";
import { getProjectedDebtItems } from "./debt-budget-items";
import { addDaysToIsoDate, shiftMonthString } from "@/lib/month";
import { clampedDueDate } from "@/lib/upcoming-money";

// A row in a category group. Stamped items are real budget_line_item rows;
// projected ones are derived (today: the Debt group) and have no id until
// materialized, so anything that needs to link to a row must check `id`.
export type BudgetGroupItem = {
  id: string | null;
  templateId: string | null;
  categoryGroupId: string;
  name: string;
  plannedAmountCents: number;
  dueDay: number | null;
  sortOrder: number;
  spentCents: number;
  projected: boolean;
};

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
  // doesn't exist yet; "projected_debt" bills are derived from debt terms and
  // carry a template id, materialized on open like the Debt group's rows.
  source: "month" | "template" | "projected_debt";
}

export interface UpcomingBills {
  overdue: UpcomingBill[];
  dueToday: UpcomingBill[];
  dueThisWeek: UpcomingBill[];
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

  const [debtGroup] = await db
    .select({ name: categoryGroups.name })
    .from(categoryGroups)
    .where(
      and(eq(categoryGroups.householdId, householdId), eq(categoryGroups.systemKey, "debt")),
    )
    .limit(1);
  const debtGroupName = debtGroup?.name ?? "Debt";

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

    // Debt payments are derived, not stamped, so a month that predates the
    // debt link has no row to find above - project them the same way the
    // budget page's Debt group does, or the mortgage silently drops out of
    // "upcoming bills". No instance means nothing was ever categorized to
    // it, so a projected debt is unpaid by construction.
    const stamped = await db
      .select({ templateItemId: budgetLineItems.templateItemId })
      .from(budgetLineItems)
      .where(eq(budgetLineItems.budgetMonthId, budgetMonth.id));
    const projected = await getProjectedDebtItems(
      householdId,
      monthDate,
      new Set(stamped.map((r) => r.templateItemId).filter((id): id is string => id !== null)),
    );
    for (const item of projected) {
      if (item.dueDay == null) continue;
      addToBucket({
        id: item.templateId,
        name: item.name,
        groupName: debtGroupName,
        dueDate: clampedDueDate(monthDate, item.dueDay),
        plannedAmountCents: item.plannedAmountCents,
        source: "projected_debt",
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
// Income groups with a pay schedule are excluded: the caller stamps those
// via ensureScheduledIncomeForMonth so the target month gets the slot count
// its own calendar calls for (2 vs 3 checks), not the source month's.
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

  const stampingPersonIds = await getStampingSchedulePersonIds(householdId);
  const sourceIncome = (
    await db
      .select({ item: incomeLineItems, personId: incomeTemplates.personId })
      .from(incomeLineItems)
      .leftJoin(incomeTemplates, eq(incomeLineItems.templateItemId, incomeTemplates.id))
      .where(eq(incomeLineItems.budgetMonthId, sourceBudgetMonthId))
  )
    .filter((row) => !(row.personId && stampingPersonIds.has(row.personId)))
    .map((row) => row.item);

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
  const itemsWithSpent: BudgetGroupItem[] = items.map((item) => ({
    ...item,
    spentCents: spentByItem.get(item.id) ?? 0,
    templateId: item.templateItemId,
    projected: false as const,
  }));

  // The Debt group is derived rather than stamped - see getProjectedDebtItems.
  // Projected rows have no id until something needs one.
  const projectedDebt: BudgetGroupItem[] = (
    await getProjectedDebtItems(
      householdId,
      monthDate,
      new Set(items.map((i) => i.templateItemId).filter((id): id is string => id !== null)),
    )
  ).map((item) => ({
    id: null,
    templateId: item.templateId,
    categoryGroupId: item.categoryGroupId,
    name: item.name,
    plannedAmountCents: item.plannedAmountCents,
    dueDay: item.dueDay,
    sortOrder: item.sortOrder,
    spentCents: 0,
    projected: true as const,
  }));
  const allItems = [...itemsWithSpent, ...projectedDebt];

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
  // Projected debt counts toward the month's planned expenses and therefore
  // "left to budget" - a payment you owe is budgeted whether or not a row
  // has been materialized for it yet.
  const plannedExpensesCents = allItems.reduce(
    (sum, i) => sum + i.plannedAmountCents,
    0,
  );

  // Projected debt alone doesn't count as "has a budget" - it's derived from
  // debt terms, not something the user planned, so a month with nothing but
  // debt projections should still offer to copy last month's budget.
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
      items: allItems
        .filter((item) => item.categoryGroupId === group.id)
        .sort((a, b) => a.sortOrder - b.sortOrder),
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
