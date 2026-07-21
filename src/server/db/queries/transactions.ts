import { and, count, desc, eq, gte, ilike, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { transactions, accounts, budgetLineItems } from "@/server/db/schema";
import { shiftMonthString } from "@/lib/month";

export async function getTransactionsForMonth(householdId: string, month: string) {
  const nextMonth = shiftMonthString(month, 1);

  return db
    .select({
      transaction: transactions,
      accountName: accounts.name,
      lineItemName: budgetLineItems.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(budgetLineItems, eq(transactions.budgetLineItemId, budgetLineItems.id))
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
  }

  return and(...conditions);
}

// Transactions not yet assigned to a budget line item or income source -
// the "needs review" inbox. All-time on purpose.
export async function getUncategorizedCount(householdId: string): Promise<number> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.budgetLineItemId),
        isNull(transactions.incomeLineItemId),
      ),
    );

  return total;
}

export async function getFilteredTransactions(householdId: string, filters: TransactionFilters) {
  const where = buildFilterConditions(householdId, filters);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        transaction: transactions,
        accountName: accounts.name,
        lineItemName: budgetLineItems.name,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(budgetLineItems, eq(transactions.budgetLineItemId, budgetLineItems.id))
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
