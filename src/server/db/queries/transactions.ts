import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  transactions,
  accounts,
  budgetLineItems,
  incomeLineItems,
  incomeTemplates,
} from "@/server/db/schema";
import { parseIncomeSlotIdentifier } from "@/lib/income-slots";
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
  // false = the "needs review" set (no line item, no income item, not a
  // transfer); true = its complement (assigned or a transfer).
  categorized?: boolean;
  // Sign of amountCents: income = inflows (> 0), expense = outflows (< 0).
  direction?: "income" | "expense";
  // Bounds compare against abs(amountCents) so "at least $50" matches a
  // $50 expense (stored negative) as well as $50 of income.
  minAmountCents?: number;
  maxAmountCents?: number;
  // A Summary-Sankey node id ("src:slot:person:<uuid>", "src:slot:tpl:<uuid>",
  // "grp:<uuid>", "item:<uuid>:<mergeKey>", "src:uncategorized",
  // "grp:uncategorized") -
  // filters to the transactions behind that node.
  flow?: string;
  page: number;
  pageSize: number;
}

// The filter set that defines *which* transactions, without pagination -
// what a bulk operation over "everything matching the current filters"
// takes.
export type TransactionWhereFilters = Omit<TransactionFilters, "page" | "pageSize">;

function buildFilterConditions(householdId: string, filters: TransactionWhereFilters) {
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
  if (filters.categorized === false) {
    conditions.push(isNull(transactions.budgetLineItemId));
    conditions.push(isNull(transactions.incomeLineItemId));
    conditions.push(eq(transactions.isTransfer, false));
  } else if (filters.categorized === true) {
    const assigned = or(
      isNotNull(transactions.budgetLineItemId),
      isNotNull(transactions.incomeLineItemId),
      eq(transactions.isTransfer, true),
    );
    if (assigned) conditions.push(assigned);
  }
  if (filters.direction === "income") {
    conditions.push(gt(transactions.amountCents, 0));
  } else if (filters.direction === "expense") {
    conditions.push(lt(transactions.amountCents, 0));
  }
  if (filters.minAmountCents !== undefined) {
    conditions.push(gte(sql`abs(${transactions.amountCents})`, filters.minAmountCents));
  }
  if (filters.maxAmountCents !== undefined) {
    conditions.push(lte(sql`abs(${transactions.amountCents})`, filters.maxAmountCents));
  }

  return and(...conditions);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolves a Sankey node id into the condition matching that node's
// transaction set, mirroring getCashflow's semantics exactly (sign-aware
// uncategorized buckets; income slots merged by personId (or templateId for
// a personless template); line items merged by templateItemId-or-normalized-
// name within a group). Returns null for ids with no transaction set
// (cashflow/surplus/deficit) and a never-true condition for ids that
// resolve to nothing.
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
    const parsed = parseIncomeSlotIdentifier(flow.slice("src:slot:".length));
    if (!parsed) return nothing;
    if (parsed.kind === "person") {
      return inArray(
        transactions.incomeLineItemId,
        db
          .select({ id: incomeLineItems.id })
          .from(incomeLineItems)
          .innerJoin(incomeTemplates, eq(incomeLineItems.templateItemId, incomeTemplates.id))
          .where(
            and(
              eq(incomeLineItems.householdId, householdId),
              eq(incomeTemplates.personId, parsed.personId),
            ),
          ),
      );
    }
    return inArray(
      transactions.incomeLineItemId,
      db
        .select({ id: incomeLineItems.id })
        .from(incomeLineItems)
        .where(
          and(
            eq(incomeLineItems.householdId, householdId),
            eq(incomeLineItems.templateItemId, parsed.templateId),
          ),
        ),
    );
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

async function buildTransactionWhere(householdId: string, filters: TransactionWhereFilters) {
  let where = buildFilterConditions(householdId, filters);
  if (filters.flow) {
    const flowCondition = await resolveFlowCondition(householdId, filters.flow);
    if (flowCondition) where = and(where, flowCondition);
  }
  return where;
}

// Sets the category links on every transaction matching the filters.
// Category changes never touch amountCents, so account balances are
// unaffected. Returns the number of rows updated.
export async function bulkSetTransactionCategory(
  householdId: string,
  filters: TransactionWhereFilters,
  links: {
    budgetLineItemId: string | null;
    incomeLineItemId: string | null;
    isTransfer: boolean;
  },
): Promise<number> {
  const where = await buildTransactionWhere(householdId, filters);
  const updated = await db
    .update(transactions)
    .set({ ...links, updatedAt: new Date() })
    .where(where)
    .returning({ id: transactions.id });
  return updated.length;
}

export async function getFilteredTransactions(householdId: string, filters: TransactionFilters) {
  const where = await buildTransactionWhere(householdId, filters);

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
