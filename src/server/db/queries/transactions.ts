import { and, count, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { transactions, accounts, budgetLineItems, incomeLineItems } from "@/server/db/schema";
import { incomeSlotGroupKey } from "@/lib/income-slots";
import { shiftMonthString } from "@/lib/month";

export async function getTransactionsForMonth(householdId: string, month: string) {
  const nextMonth = shiftMonthString(month, 1);

  return db
    .select({
      transaction: transactions,
      accountName: accounts.name,
      lineItemName: budgetLineItems.name,
      incomeItemName: incomeLineItems.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(budgetLineItems, eq(transactions.budgetLineItemId, budgetLineItems.id))
    .leftJoin(incomeLineItems, eq(transactions.incomeLineItemId, incomeLineItems.id))
    .where(
      and(
        eq(transactions.householdId, householdId),
        gte(transactions.postedDate, month),
        lt(transactions.postedDate, nextMonth),
      ),
    )
    .orderBy(desc(transactions.postedDate), desc(transactions.createdAt));
}

export interface TransactionFilters {
  search?: string;
  accountIds?: string[];
  startDate?: string;
  endDate?: string;
  pending?: boolean;
  uncategorized?: boolean;
  // A Summary-Sankey node id ("src:slot:natasha", "grp:<uuid>",
  // "item:<uuid>:<mergeKey>", "src:uncategorized", "grp:uncategorized") -
  // filters to the transactions behind that node.
  flow?: string;
  page: number;
  pageSize: number;
}

function buildFilterConditions(householdId: string, filters: TransactionFilters) {
  const conditions = [eq(transactions.householdId, householdId)];

  if (filters.search) {
    conditions.push(ilike(transactions.description, `%${filters.search}%`));
  }
  if (filters.accountIds && filters.accountIds.length > 0) {
    conditions.push(inArray(transactions.accountId, filters.accountIds));
  }
  if (filters.startDate) {
    conditions.push(gte(transactions.postedDate, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(transactions.postedDate, filters.endDate));
  }
  if (filters.pending !== undefined) {
    conditions.push(eq(transactions.pending, filters.pending));
  }
  if (filters.uncategorized) {
    conditions.push(isNull(transactions.budgetLineItemId));
    conditions.push(isNull(transactions.incomeLineItemId));
    conditions.push(eq(transactions.isTransfer, false));
  }

  return and(...conditions);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolves a Sankey node id into the condition matching that node's
// transaction set, mirroring getCashflow's semantics exactly (sign-aware
// uncategorized buckets; income slots merged by name-derived group key;
// line items merged by templateItemId-or-normalized-name within a group).
// Returns null for ids with no transaction set (cashflow/surplus/deficit)
// and a never-true condition for ids that resolve to nothing.
async function resolveFlowCondition(householdId: string, flow: string) {
  const nothing = sql`false`;

  if (flow === "src:uncategorized") {
    return and(
      isNull(transactions.budgetLineItemId),
      isNull(transactions.incomeLineItemId),
      eq(transactions.isTransfer, false),
      gt(transactions.amountCents, 0),
    );
  }
  if (flow === "grp:uncategorized") {
    return and(
      isNull(transactions.budgetLineItemId),
      isNull(transactions.incomeLineItemId),
      eq(transactions.isTransfer, false),
      lt(transactions.amountCents, 0),
    );
  }
  if (flow.startsWith("src:slot:")) {
    const groupKey = flow.slice("src:slot:".length);
    const items = await db
      .select({ id: incomeLineItems.id, name: incomeLineItems.name })
      .from(incomeLineItems)
      .where(eq(incomeLineItems.householdId, householdId));
    const ids = items
      .filter((item) => incomeSlotGroupKey(item.name) === groupKey)
      .map((item) => item.id);
    return ids.length > 0 ? inArray(transactions.incomeLineItemId, ids) : nothing;
  }
  if (flow.startsWith("item:")) {
    const rest = flow.slice("item:".length);
    const separator = rest.indexOf(":");
    if (separator < 0) return nothing;
    const groupId = rest.slice(0, separator);
    const mergeKey = rest.slice(separator + 1);
    if (!UUID_PATTERN.test(groupId)) return nothing;
    const items = await db
      .select({
        id: budgetLineItems.id,
        templateItemId: budgetLineItems.templateItemId,
        name: budgetLineItems.name,
      })
      .from(budgetLineItems)
      .where(
        and(
          eq(budgetLineItems.householdId, householdId),
          eq(budgetLineItems.categoryGroupId, groupId),
        ),
      );
    const ids = items
      .filter(
        (item) =>
          (item.templateItemId ?? `name:${item.name.trim().toLowerCase()}`) === mergeKey,
      )
      .map((item) => item.id);
    return ids.length > 0 ? inArray(transactions.budgetLineItemId, ids) : nothing;
  }
  if (flow.startsWith("grp:")) {
    const groupId = flow.slice("grp:".length);
    if (!UUID_PATTERN.test(groupId)) return nothing;
    return inArray(
      transactions.budgetLineItemId,
      db
        .select({ id: budgetLineItems.id })
        .from(budgetLineItems)
        .where(
          and(
            eq(budgetLineItems.householdId, householdId),
            eq(budgetLineItems.categoryGroupId, groupId),
          ),
        ),
    );
  }
  return null;
}

// Transactions not yet assigned to a budget line item or income source -
// the "needs review" inbox. All-time on purpose. Transfers are handled,
// not pending review, so they don't count.
export async function getUncategorizedCount(householdId: string): Promise<number> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.budgetLineItemId),
        isNull(transactions.incomeLineItemId),
        eq(transactions.isTransfer, false),
      ),
    );

  return total;
}

export async function getFilteredTransactions(householdId: string, filters: TransactionFilters) {
  let where = buildFilterConditions(householdId, filters);
  if (filters.flow) {
    const flowCondition = await resolveFlowCondition(householdId, filters.flow);
    if (flowCondition) where = and(where, flowCondition);
  }

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        transaction: transactions,
        accountName: accounts.name,
        lineItemName: budgetLineItems.name,
        incomeItemName: incomeLineItems.name,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(budgetLineItems, eq(transactions.budgetLineItemId, budgetLineItems.id))
      .leftJoin(incomeLineItems, eq(transactions.incomeLineItemId, incomeLineItems.id))
      .where(where)
      .orderBy(desc(transactions.postedDate), desc(transactions.createdAt))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ total: count() }).from(transactions).where(where),
  ]);

  return { rows, totalCount: total };
}

// spentCents = -SUM(amountCents): outflows are stored negative, so this
// yields a positive "amount spent" that a refund (positive amountCents)
// naturally reduces.
export async function getSpentCentsByLineItem(
  lineItemIds: string[],
): Promise<Map<string, number>> {
  if (lineItemIds.length === 0) return new Map();

  const rows = await db
    .select({
      budgetLineItemId: transactions.budgetLineItemId,
      spentCents: sql<number>`-sum(${transactions.amountCents})`,
    })
    .from(transactions)
    .where(inArray(transactions.budgetLineItemId, lineItemIds))
    .groupBy(transactions.budgetLineItemId);

  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.budgetLineItemId) map.set(row.budgetLineItemId, Number(row.spentCents));
  }
  return map;
}

// Income analog of getSpentCentsByLineItem: no negation, since income is
// stored positive (a reversal naturally nets the total down).
export async function getReceivedCentsByIncomeItem(
  incomeItemIds: string[],
): Promise<Map<string, number>> {
  if (incomeItemIds.length === 0) return new Map();

  const rows = await db
    .select({
      incomeLineItemId: transactions.incomeLineItemId,
      receivedCents: sql<number>`sum(${transactions.amountCents})`,
    })
    .from(transactions)
    .where(inArray(transactions.incomeLineItemId, incomeItemIds))
    .groupBy(transactions.incomeLineItemId);

  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.incomeLineItemId) map.set(row.incomeLineItemId, Number(row.receivedCents));
  }
  return map;
}

export async function getTransactionsForLineItem(lineItemId: string) {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.budgetLineItemId, lineItemId))
    .orderBy(desc(transactions.postedDate), desc(transactions.createdAt));
}

export async function getTransaction(householdId: string, transactionId: string) {
  const [row] = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.householdId, householdId),
      ),
    )
    .limit(1);

  return row ?? null;
}
