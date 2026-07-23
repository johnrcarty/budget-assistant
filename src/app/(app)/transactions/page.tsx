import Link from "next/link";
import { Plus, Upload, Wand2, X } from "lucide-react";
import { getCurrentHousehold } from "@/server/lib/dal";
import { getAccounts } from "@/server/db/queries/accounts";
import {
  getFilteredTransactions,
  type TransactionWhereFilters,
} from "@/server/db/queries/transactions";
import { getExpenseTargets, getIncomeTargets } from "@/server/db/queries/categorization";
import { formatFullDate } from "@/lib/month";
import { resolveDateRange, isDateRangePreset } from "@/lib/date-range";
import { formatCents, dollarsToCents } from "@/server/lib/money";
import { AppHeader } from "@/components/layout/AppHeader";
import { TransactionDialog } from "@/components/transactions/TransactionDialog";
import { BulkCategorizeDialog } from "@/components/transactions/BulkCategorizeDialog";
import { TransactionsToolbar } from "@/components/transactions/TransactionsToolbar";
import { TransactionPagination } from "@/components/transactions/TransactionPagination";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const DEFAULT_PAGE_SIZE = 20;
const VALID_PAGE_SIZES = new Set([10, 20, 50]);

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value: string | undefined): string | undefined {
  return value && ISO_DATE_PATTERN.test(value) ? value : undefined;
}

function parseAmountCents(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const dollars = Number(value);
  if (!Number.isFinite(dollars) || dollars < 0) return undefined;
  return dollarsToCents(dollars);
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    range?: string;
    from?: string;
    to?: string;
    status?: string;
    accounts?: string;
    type?: string;
    categorized?: string;
    uncategorized?: string;
    min?: string;
    max?: string;
    flow?: string;
    flowLabel?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  const params = await searchParams;
  const { startDate, endDate } =
    params.range === "custom"
      ? { startDate: parseIsoDate(params.from), endDate: parseIsoDate(params.to) }
      : resolveDateRange(isDateRangePreset(params.range) ? params.range : "30d");
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = VALID_PAGE_SIZES.has(Number(params.pageSize))
    ? Number(params.pageSize)
    : DEFAULT_PAGE_SIZE;
  const accountIds = params.accounts?.split(",").filter(Boolean);
  const pending = params.status === "pending" ? true : params.status === "cleared" ? false : undefined;
  // "uncategorized=1" is the legacy spelling of categorized=0.
  const categorized =
    params.categorized === "1"
      ? true
      : params.categorized === "0" || params.uncategorized === "1"
        ? false
        : undefined;
  const direction =
    params.type === "income" || params.type === "expense" ? params.type : undefined;
  const minAmountCents = parseAmountCents(params.min);
  const maxAmountCents = parseAmountCents(params.max);
  const flow = params.flow || undefined;
  // Display-only caption for the flow chip; the actual filter comes from
  // the flow id. Fallback covers hand-edited URLs.
  const flowLabel = params.flowLabel?.slice(0, 80) || "Cash flow selection";
  const clearFlowParams = new URLSearchParams(
    Object.entries(params).filter(
      ([key, value]) => value && !["flow", "flowLabel", "page"].includes(key),
    ) as [string, string][],
  ).toString();

  // The pagination-free filter set: what getFilteredTransactions matches
  // against, and what bulk categorize applies to.
  const whereFilters: TransactionWhereFilters = {
    search: params.search,
    accountIds,
    startDate,
    endDate,
    pending,
    categorized,
    direction,
    minAmountCents,
    maxAmountCents,
    flow,
  };

  const householdId = await getCurrentHousehold();
  const [accountList, { rows, totalCount }, expenseTargets, incomeTargets] = await Promise.all([
    getAccounts(householdId),
    getFilteredTransactions(householdId, { ...whereFilters, page, pageSize }),
    getExpenseTargets(householdId),
    getIncomeTargets(householdId),
  ]);

  return (
    <div>
      <AppHeader
        title="Transactions"
        rightAction={
          accountList.length > 0 ? (
            <div className="flex items-center gap-4">
              <Link href="/transactions/categorize" aria-label="Categorize transactions">
                <Wand2 className="size-5" />
              </Link>
              <Link href="/transactions/import" aria-label="Import CSV">
                <Upload className="size-5" />
              </Link>
              <TransactionDialog
                accounts={accountList}
                expenseTargets={expenseTargets}
                incomeTargets={incomeTargets}
                trigger={<Plus className="size-6" />}
              />
            </div>
          ) : null
        }
      />

      {accountList.length > 0 && <TransactionsToolbar accountList={accountList} />}

      <div className="px-4 pb-4">
        {flow && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-secondary px-3 py-2 text-sm">
            <span className="min-w-0 truncate">
              Cash flow: <span className="font-medium">{flowLabel}</span>
            </span>
            <Link
              href={`/transactions${clearFlowParams ? `?${clearFlowParams}` : ""}`}
              className="shrink-0 font-medium text-muted-foreground"
              aria-label="Clear cash flow filter"
            >
              <X className="size-4" />
            </Link>
          </div>
        )}
        {accountList.length === 0 ? (
          <p className="pt-8 text-center text-muted-foreground">
            Add an account first (Accounts tab) before logging transactions.
          </p>
        ) : rows.length === 0 ? (
          <p className="pt-8 text-center text-muted-foreground">
            No transactions match these filters.
          </p>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                {totalCount} {totalCount === 1 ? "transaction" : "transactions"}
              </span>
              <BulkCategorizeDialog
                filters={whereFilters}
                totalCount={totalCount}
                expenseTargets={expenseTargets}
                incomeTargets={incomeTargets}
              />
            </div>
            <Card>
              <CardContent>
                {rows.map(({
                  transaction,
                  accountName,
                  lineItemName,
                  lineItemTemplateId,
                  incomeItemName,
                  incomeTemplateId,
                }, index) => {
                  const isNewDay =
                    index === 0 ||
                    rows[index - 1].transaction.postedDate !== transaction.postedDate;
                  const dayRows = isNewDay
                    ? rows.filter((r) => r.transaction.postedDate === transaction.postedDate)
                    : [];
                  const dayTotalCents = dayRows.reduce(
                    (sum, r) => sum + r.transaction.amountCents,
                    0,
                  );

                  return (
                    <div key={transaction.id}>
                      {isNewDay && (
                        <div className="-mx-4 flex items-center justify-between border-b bg-muted px-4 py-1.5 text-sm text-muted-foreground first:mt-0 [&:not(:first-child)]:mt-2">
                          <span>
                            {formatFullDate(transaction.postedDate)} · {dayRows.length}
                          </span>
                          <span>{formatCents(dayTotalCents)}</span>
                        </div>
                      )}
                      <TransactionDialog
                        accounts={accountList}
                        expenseTargets={expenseTargets}
                        incomeTargets={incomeTargets}
                        transaction={transaction}
                        currentExpenseTemplateId={lineItemTemplateId}
                        currentIncomeTemplateId={incomeTemplateId}
                        currentCategoryName={lineItemName ?? incomeItemName}
                        triggerClassName="block w-full text-left"
                        trigger={
                          <div className="flex w-full items-center justify-between gap-3 border-b py-3 text-left last:border-b-0">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate font-medium">
                                  {transaction.description}
                                </span>
                                {transaction.pending && (
                                  <Badge variant="secondary" className="shrink-0">
                                    Pending
                                  </Badge>
                                )}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {accountName} ·{" "}
                                {lineItemName ??
                                  incomeItemName ??
                                  (transaction.isTransfer ? "Transfer" : "Uncategorized")}
                              </div>
                            </div>
                            <div
                              className={
                                transaction.amountCents < 0
                                  ? "shrink-0 whitespace-nowrap font-medium"
                                  : "shrink-0 whitespace-nowrap font-medium text-primary"
                              }
                            >
                              {formatCents(transaction.amountCents)}
                            </div>
                          </div>
                        }
                      />
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <TransactionPagination page={page} pageSize={pageSize} totalCount={totalCount} />
          </>
        )}
      </div>
    </div>
  );
}
