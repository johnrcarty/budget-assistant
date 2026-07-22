import { and, desc, eq, gt, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { incomeSlotGroupKey, incomeSlotGroupLabel } from "@/lib/income-slots";
import { db } from "@/server/db/client";
import {
  transactions,
  budgetLineItems,
  categoryGroups,
  incomeLineItems,
} from "@/server/db/schema";

export interface CashflowRange {
  startDate?: string;
  endDate?: string;
}

export interface CashflowItem {
  key: string;
  name: string;
  totalCents: number;
}

export interface CashflowGroup {
  key: string;
  name: string;
  groupId: string;
  totalCents: number;
  items: CashflowItem[];
}

export interface CashflowData {
  incomeSources: CashflowItem[];
  uncategorizedIncomeCents: number;
  groups: CashflowGroup[];
  uncategorizedExpenseCents: number;
  totalIncomeCents: number;
  totalExpenseCents: number;
  surplusCents: number;
}

function dateConditions(range: CashflowRange) {
  const conditions = [];
  if (range.startDate) conditions.push(gte(transactions.postedDate, range.startDate));
  if (range.endDate) conditions.push(lte(transactions.postedDate, range.endDate));
  return conditions;
}

// Line items are per-month instances, so a multi-month range yields one row
// per month for the same recurring item. Merge on the template id when the
// item is template-stamped, else on the normalized name, so "Rent" across
// twelve months is a single node.
function mergeKey(templateItemId: string | null, name: string): string {
  return templateItemId ?? `name:${name.trim().toLowerCase()}`;
}

// Income merges one level coarser than expenses: numbered paycheck slots
// ("Natasha 1", "Natasha 2") collapse into a single per-person source via the
// same name convention the slot-filling engine uses.
function mergeIncomeSources(
  rows: { name: string; totalCents: number }[],
): CashflowItem[] {
  const merged = new Map<string, CashflowItem>();
  for (const row of rows) {
    const key = `slot:${incomeSlotGroupKey(row.name)}`;
    const existing = merged.get(key);
    if (existing) {
      existing.totalCents += row.totalCents;
    } else {
      merged.set(key, {
        key,
        name: incomeSlotGroupLabel(row.name),
        totalCents: row.totalCents,
      });
    }
  }
  return [...merged.values()]
    .filter((item) => item.totalCents > 0)
    .sort((a, b) => b.totalCents - a.totalCents);
}

function mergeItems(
  rows: { templateItemId: string | null; name: string; totalCents: number }[],
): CashflowItem[] {
  const merged = new Map<string, CashflowItem>();
  for (const row of rows) {
    const key = mergeKey(row.templateItemId, row.name);
    const existing = merged.get(key);
    if (existing) {
      existing.totalCents += row.totalCents;
    } else {
      merged.set(key, { key, name: row.name, totalCents: row.totalCents });
    }
  }
  return [...merged.values()]
    .filter((item) => item.totalCents > 0)
    .sort((a, b) => b.totalCents - a.totalCents);
}

export async function getCashflow(
  householdId: string,
  range: CashflowRange,
): Promise<CashflowData> {
  const dates = dateConditions(range);

  const [incomeRows, [uncategorizedIncome], expenseRows, [uncategorizedExpense]] =
    await Promise.all([
      // Income by source. Ordered by month so that when rows merge, the first
      // row seen (most recent month) supplies the display name.
      db
        .select({
          templateItemId: incomeLineItems.templateItemId,
          name: incomeLineItems.name,
          totalCents: sql<number>`sum(${transactions.amountCents})`,
        })
        .from(transactions)
        .innerJoin(incomeLineItems, eq(transactions.incomeLineItemId, incomeLineItems.id))
        .where(and(eq(transactions.householdId, householdId), ...dates))
        .groupBy(incomeLineItems.templateItemId, incomeLineItems.name)
        .orderBy(desc(sql`max(${transactions.postedDate})`)),
      // Positive transactions linked to neither side. (A positive transaction
      // linked to a budget line item is a refund - it nets against that
      // category below, and never counts as income. Transfers between own
      // accounts are neither income nor spending.)
      db
        .select({ totalCents: sql<number>`coalesce(sum(${transactions.amountCents}), 0)` })
        .from(transactions)
        .where(
          and(
            eq(transactions.householdId, householdId),
            isNull(transactions.budgetLineItemId),
            isNull(transactions.incomeLineItemId),
            eq(transactions.isTransfer, false),
            gt(transactions.amountCents, 0),
            ...dates,
          ),
        ),
      // Expenses by category group and line item; outflows are stored
      // negative, so -sum() yields positive spend that refunds reduce.
      db
        .select({
          groupId: categoryGroups.id,
          groupName: categoryGroups.name,
          groupSortOrder: categoryGroups.sortOrder,
          templateItemId: budgetLineItems.templateItemId,
          name: budgetLineItems.name,
          totalCents: sql<number>`-sum(${transactions.amountCents})`,
        })
        .from(transactions)
        .innerJoin(budgetLineItems, eq(transactions.budgetLineItemId, budgetLineItems.id))
        .innerJoin(categoryGroups, eq(budgetLineItems.categoryGroupId, categoryGroups.id))
        .where(and(eq(transactions.householdId, householdId), ...dates))
        .groupBy(
          categoryGroups.id,
          categoryGroups.name,
          categoryGroups.sortOrder,
          budgetLineItems.templateItemId,
          budgetLineItems.name,
        )
        .orderBy(desc(sql`max(${transactions.postedDate})`)),
      db
        .select({ totalCents: sql<number>`coalesce(-sum(${transactions.amountCents}), 0)` })
        .from(transactions)
        .where(
          and(
            eq(transactions.householdId, householdId),
            isNull(transactions.budgetLineItemId),
            isNull(transactions.incomeLineItemId),
            eq(transactions.isTransfer, false),
            lt(transactions.amountCents, 0),
            ...dates,
          ),
        ),
    ]);

  const incomeSources = mergeIncomeSources(
    incomeRows.map((row) => ({ name: row.name, totalCents: Number(row.totalCents) })),
  );

  const groupMap = new Map<
    string,
    {
      name: string;
      sortOrder: number;
      rows: { templateItemId: string | null; name: string; totalCents: number }[];
    }
  >();
  for (const row of expenseRows) {
    let group = groupMap.get(row.groupId);
    if (!group) {
      group = { name: row.groupName, sortOrder: row.groupSortOrder, rows: [] };
      groupMap.set(row.groupId, group);
    }
    group.rows.push({
      templateItemId: row.templateItemId,
      name: row.name,
      totalCents: Number(row.totalCents),
    });
  }

  const groups: CashflowGroup[] = [...groupMap.entries()]
    .map(([groupId, group]) => {
      const items = mergeItems(group.rows);
      return {
        key: groupId,
        name: group.name,
        groupId,
        sortOrder: group.sortOrder,
        totalCents: items.reduce((sum, item) => sum + item.totalCents, 0),
        items,
      };
    })
    .filter((group) => group.totalCents > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((group) => ({
      key: group.key,
      name: group.name,
      groupId: group.groupId,
      totalCents: group.totalCents,
      items: group.items,
    }));

  const uncategorizedIncomeCents = Number(uncategorizedIncome.totalCents);
  const uncategorizedExpenseCents = Number(uncategorizedExpense.totalCents);

  const totalIncomeCents =
    incomeSources.reduce((sum, source) => sum + source.totalCents, 0) +
    uncategorizedIncomeCents;
  const totalExpenseCents =
    groups.reduce((sum, group) => sum + group.totalCents, 0) + uncategorizedExpenseCents;

  return {
    incomeSources,
    uncategorizedIncomeCents,
    groups,
    uncategorizedExpenseCents,
    totalIncomeCents,
    totalExpenseCents,
    surplusCents: totalIncomeCents - totalExpenseCents,
  };
}
