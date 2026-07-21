import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  accounts,
  budgetLineItems,
  debtBalanceSnapshots,
  debtPlans,
  lineItemTemplates,
} from "@/server/db/schema";
import { currentEffectiveTerms, latestKnownBalance, toSimTerms } from "./debt";
import { getBudgetMonth } from "./budget";
import {
  buildPortfolioHistory,
  simulateDebtPlan,
  type DebtPlanResult,
  type HistoryPoint,
  type SimDebtInput,
} from "@/server/lib/debt-sim";
import { currentDateString, currentMonthString, shiftMonthString } from "@/lib/month";

export interface DebtPlanSettings {
  strategy: "snowball" | "avalanche";
  extraMonthlyCents: number;
}

export async function getDebtPlanSettings(householdId: string): Promise<DebtPlanSettings> {
  const [row] = await db
    .select()
    .from(debtPlans)
    .where(eq(debtPlans.householdId, householdId))
    .limit(1);
  return row ?? { strategy: "snowball", extraMonthlyCents: 0 };
}

// The budget template representing one debt, if the debt has ever been
// linked. isActive=false means currently unlinked (re-link reactivates).
export async function getLinkedDebtTemplate(householdId: string, accountId: string) {
  const [template] = await db
    .select()
    .from(lineItemTemplates)
    .where(
      and(
        eq(lineItemTemplates.householdId, householdId),
        eq(lineItemTemplates.debtAccountId, accountId),
      ),
    )
    .limit(1);
  return template ?? null;
}

export interface LinkedBudgetItem {
  templateId: string;
  isActive: boolean;
  plannedMonthlyCents: number; // current month instance, else template default
}

export interface DebtPlanData {
  settings: DebtPlanSettings;
  accounts: (typeof accounts.$inferSelect)[];
  sim: DebtPlanResult;
  history: HistoryPoint[];
  linkedByAccount: Map<string, LinkedBudgetItem>;
  startMonth: string;
}

export async function getDebtPlanData(householdId: string): Promise<DebtPlanData> {
  const startMonth = currentMonthString();
  const today = currentDateString();

  const [settings, liabilities] = await Promise.all([
    getDebtPlanSettings(householdId),
    db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, householdId),
          eq(accounts.isLiability, true),
          eq(accounts.isArchived, false),
        ),
      )
      .orderBy(asc(accounts.name)),
  ]);
  const accountIds = liabilities.map((a) => a.id);

  // Budgeted payments come from templates linked via debtAccountId, reading
  // the current month's instance when one exists (getBudgetMonth is
  // read-only on purpose - a dashboard load must not insert budget rows).
  const templates =
    accountIds.length > 0
      ? await db
          .select()
          .from(lineItemTemplates)
          .where(
            and(
              eq(lineItemTemplates.householdId, householdId),
              isNotNull(lineItemTemplates.debtAccountId),
            ),
          )
      : [];
  const budgetMonth = await getBudgetMonth(householdId, startMonth);
  const instances =
    budgetMonth && templates.length > 0
      ? await db
          .select()
          .from(budgetLineItems)
          .where(
            and(
              eq(budgetLineItems.budgetMonthId, budgetMonth.id),
              inArray(
                budgetLineItems.templateItemId,
                templates.map((t) => t.id),
              ),
            ),
          )
      : [];

  const linkedByAccount = new Map<string, LinkedBudgetItem>();
  for (const template of templates) {
    if (!template.debtAccountId) continue;
    const instance = instances.find((i) => i.templateItemId === template.id);
    linkedByAccount.set(template.debtAccountId, {
      templateId: template.id,
      isActive: template.isActive,
      plannedMonthlyCents: instance?.plannedAmountCents ?? template.defaultPlannedAmountCents,
    });
  }

  const simDebts: SimDebtInput[] = await Promise.all(
    liabilities.map(async (account) => {
      const [terms, balance] = await Promise.all([
        currentEffectiveTerms(account.id),
        latestKnownBalance(account.id),
      ]);
      const linked = linkedByAccount.get(account.id);
      return {
        accountId: account.id,
        name: account.name,
        balanceCents: balance?.balanceCents ?? account.currentBalanceCents ?? 0,
        originalBalanceCents: account.originalBalanceCents,
        terms: terms ? toSimTerms(terms) : null,
        budgetedMonthlyCents:
          linked && linked.isActive ? linked.plannedMonthlyCents : null,
      };
    }),
  );

  const sim = simulateDebtPlan({
    debts: simDebts,
    strategy: settings.strategy,
    extraMonthlyCents: settings.extraMonthlyCents,
    startMonth,
  });

  // Portfolio balance history from snapshots, sampled at month starts plus
  // today so the line ends at the present.
  const snapshots =
    accountIds.length > 0
      ? await db
          .select()
          .from(debtBalanceSnapshots)
          .where(inArray(debtBalanceSnapshots.accountId, accountIds))
          .orderBy(asc(debtBalanceSnapshots.asOfDate), asc(debtBalanceSnapshots.createdAt))
      : [];
  const snapshotsByAccount = new Map<string, { asOfDate: string; balanceCents: number }[]>();
  for (const snap of snapshots) {
    const list = snapshotsByAccount.get(snap.accountId) ?? [];
    list.push({ asOfDate: snap.asOfDate, balanceCents: snap.balanceCents });
    snapshotsByAccount.set(snap.accountId, list);
  }

  const sampleDates: string[] = [];
  if (snapshots.length > 0) {
    let month = `${snapshots[0].asOfDate.slice(0, 7)}-01`;
    while (month <= startMonth) {
      sampleDates.push(month);
      month = shiftMonthString(month, 1);
    }
    if (today > startMonth) sampleDates.push(today);
  }
  const history = buildPortfolioHistory(snapshotsByAccount, sampleDates);

  return { settings, accounts: liabilities, sim, history, linkedByAccount, startMonth };
}
