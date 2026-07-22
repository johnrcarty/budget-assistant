import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { currentDateString, currentMonthString } from "@/lib/month";
import { db } from "@/server/db/client";
import { getAccounts } from "@/server/db/queries/accounts";
import { getBudgetMonth, getBudgetOverview, getUpcomingBills } from "@/server/db/queries/budget";
import {
  currentEffectiveTerms,
  getDebtAccounts,
  projectPayoff,
} from "@/server/db/queries/debt";
import { getFilteredTransactions } from "@/server/db/queries/transactions";
import { households } from "@/server/db/schema";
import { formatCents } from "@/server/lib/money";

// MCP tools are read-only wrappers around the existing query layer, shaped
// for a voice assistant to read back - concise sentences, formatted
// dollars, no raw DB rows. There is no session on this endpoint (bearer
// token auth happens in the route handler), so the household is resolved
// directly: this is a single-household app by design (see dal.ts).
async function resolveHouseholdId(): Promise<string> {
  const [household] = await db.select({ id: households.id }).from(households).limit(1);
  if (!household) {
    throw new Error("No household exists yet - complete app setup first.");
  }
  return household.id;
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

// "2026-07-25" -> "Fri, Jul 25" - short enough to speak, unambiguous.
function speakDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// "2026-07-01" -> "July 2026"
function speakMonth(monthDate: string): string {
  return new Date(`${monthDate.slice(0, 7)}-15T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function registerBudgetTools(server: McpServer) {
  server.registerTool(
    "get_upcoming_bills",
    {
      title: "Upcoming bills",
      description:
        "Unpaid budget bills that are overdue, due today, or due in the next 7 days. " +
        "Use for questions like 'do I have any bills coming up?'",
    },
    async () => {
      const householdId = await resolveHouseholdId();
      const bills = await getUpcomingBills(householdId, currentDateString());

      const describe = (list: { name: string; plannedAmountCents: number; dueDate: string }[]) =>
        list
          .map((b) => `${b.name} (${formatCents(b.plannedAmountCents)}) due ${speakDate(b.dueDate)}`)
          .join("; ");

      const parts: string[] = [];
      if (bills.overdue.length > 0) {
        parts.push(`${bills.overdue.length} overdue: ${describe(bills.overdue)}.`);
      }
      if (bills.dueToday.length > 0) {
        parts.push(`Due today: ${describe(bills.dueToday)}.`);
      }
      if (bills.dueThisWeek.length > 0) {
        parts.push(`Due in the next 7 days: ${describe(bills.dueThisWeek)}.`);
      }
      if (parts.length === 0) {
        return text("No unpaid bills are overdue or due in the next 7 days.");
      }
      return text(parts.join(" "));
    },
  );

  server.registerTool(
    "get_recent_transactions",
    {
      title: "Recent transactions",
      description:
        "Most recent transactions, newest first. Optionally filter by a search term " +
        "(matches the transaction description) or limit how many to return.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(10)
          .describe("How many transactions to return (default 10)"),
        search: z.string().trim().min(1).max(100).optional()
          .describe("Only transactions whose description contains this text"),
      },
    },
    async ({ limit, search }) => {
      const householdId = await resolveHouseholdId();
      const { rows, totalCount } = await getFilteredTransactions(householdId, {
        search,
        page: 1,
        pageSize: limit,
      });

      if (rows.length === 0) {
        return text(search ? `No transactions match "${search}".` : "No transactions found.");
      }

      const lines = rows.map(({ transaction, accountName, lineItemName, incomeItemName }) => {
        const category = incomeItemName ?? lineItemName;
        const suffix = category ? `, ${category}` : transaction.isTransfer ? ", transfer" : "";
        const pending = transaction.pending ? ", pending" : "";
        return `${speakDate(transaction.postedDate)}: ${transaction.description} ${formatCents(
          transaction.amountCents,
        )} (${accountName}${suffix}${pending})`;
      });

      const more = totalCount > rows.length ? ` (${totalCount - rows.length} more not shown)` : "";
      return text(`${rows.length} transaction${rows.length === 1 ? "" : "s"}${more}: ${lines.join("; ")}`);
    },
  );

  server.registerTool(
    "get_budget_summary",
    {
      title: "Budget summary",
      description:
        "Budget status for a month: income planned vs received, expenses planned, left to " +
        "budget, and spending per category group. Use for 'how's the budget looking?'",
      inputSchema: {
        month: z.string().regex(/^\d{4}-\d{2}$/).optional()
          .describe("Month as YYYY-MM (defaults to the current month)"),
      },
    },
    async ({ month }) => {
      const householdId = await resolveHouseholdId();
      const monthDate = month ? `${month}-01` : currentMonthString();
      const label = speakMonth(monthDate);

      // Read-only guard: getBudgetOverview would create the month row when
      // missing (write-on-read for the interactive budget page); this
      // endpoint must not, so bail out first.
      const budgetMonth = await getBudgetMonth(householdId, monthDate);
      if (!budgetMonth) {
        return text(`No budget exists for ${label}.`);
      }

      const overview = await getBudgetOverview(householdId, monthDate);
      if (!overview.hasBudget) {
        return text(`No budget exists for ${label}.`);
      }

      const groupParts = overview.groups
        .filter((group) => group.items.length > 0)
        .map((group) => {
          const planned = group.items.reduce((sum, i) => sum + i.plannedAmountCents, 0);
          const spent = group.items.reduce((sum, i) => sum + i.spentCents, 0);
          return `${group.name} ${formatCents(spent)} of ${formatCents(planned)}`;
        });

      const summary =
        `${label}: income ${formatCents(overview.receivedIncomeCents)} received of ` +
        `${formatCents(overview.plannedIncomeCents)} planned; expenses planned ` +
        `${formatCents(overview.plannedExpensesCents)}; left to budget ` +
        `${formatCents(overview.leftToBudgetCents)}.` +
        (groupParts.length > 0 ? ` Spent by category: ${groupParts.join("; ")}.` : "");
      return text(summary);
    },
  );

  server.registerTool(
    "get_account_balances",
    {
      title: "Account balances",
      description:
        "Current balance of every active account, grouped into assets and debts, with " +
        "totals and net worth.",
    },
    async () => {
      const householdId = await resolveHouseholdId();
      const accounts = await getAccounts(householdId);
      if (accounts.length === 0) {
        return text("No accounts exist yet.");
      }

      const describe = (list: typeof accounts) =>
        list.map((a) => `${a.name} ${formatCents(a.currentBalanceCents ?? 0)}`).join("; ");
      const total = (list: typeof accounts) =>
        list.reduce((sum, a) => sum + (a.currentBalanceCents ?? 0), 0);

      const assets = accounts.filter((a) => !a.isLiability);
      const debts = accounts.filter((a) => a.isLiability);

      const parts: string[] = [];
      if (assets.length > 0) {
        parts.push(`Assets (${formatCents(total(assets))} total): ${describe(assets)}.`);
      }
      if (debts.length > 0) {
        parts.push(`Debts (${formatCents(total(debts))} total owed): ${describe(debts)}.`);
      }
      parts.push(`Net worth: ${formatCents(total(assets) - total(debts))}.`);
      return text(parts.join(" "));
    },
  );

  server.registerTool(
    "get_debt_summary",
    {
      title: "Debt summary",
      description:
        "Payoff status for each debt: balance, APR, and projected payoff date at the " +
        "current payment. Use for 'how are the debts doing?'",
    },
    async () => {
      const householdId = await resolveHouseholdId();
      const debts = await getDebtAccounts(householdId);
      if (debts.length === 0) {
        return text("No debt accounts exist.");
      }

      let totalCents = 0;
      const lines = await Promise.all(
        debts.map(async ({ account, latestBalance }) => {
          const balanceCents = latestBalance?.balanceCents ?? account.currentBalanceCents ?? 0;
          totalCents += balanceCents;

          const terms = await currentEffectiveTerms(account.id);
          if (!terms) {
            return `${account.name}: ${formatCents(balanceCents)} owed (no terms set, can't project payoff)`;
          }

          const apr = terms.aprBps !== null ? `${(terms.aprBps / 100).toFixed(2)}% APR` : "APR unknown";
          const projection = projectPayoff(balanceCents, terms);
          if (projection.payoffDate !== null) {
            return (
              `${account.name}: ${formatCents(balanceCents)} owed at ${apr}, paid off ` +
              `${speakMonth(projection.payoffDate)} (${formatCents(projection.totalInterestCents ?? 0)} interest)`
            );
          }
          if (projection.monthsToPayoff === 0) {
            return `${account.name}: paid off`;
          }
          return `${account.name}: ${formatCents(balanceCents)} owed at ${apr} (${projection.note ?? "no projection"})`;
        }),
      );

      return text(`Total debt ${formatCents(totalCents)}. ${lines.join(". ")}.`);
    },
  );
}
