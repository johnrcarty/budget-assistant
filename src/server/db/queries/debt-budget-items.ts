// Read-only on purpose: queries/budget.ts imports this module, so it must
// not import back. The write side (materializing a projected row) lives in
// queries/line-item-instances.ts, which already owns on-demand instance
// creation and can safely reach getOrCreateBudgetMonth.
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { accounts, lineItemTemplates } from "@/server/db/schema";
import { currentEffectiveTerms, latestKnownBalance, toSimTerms } from "./debt";
import { currentRequiredMonthlyCents, monthlyEscrowCents } from "@/server/lib/debt-sim";
import { currentMonthString } from "@/lib/month";

// The Debt group's contents are DERIVED, not stamped. A budget month created
// before a debt was linked would otherwise never show that debt's payment
// (linkDebtToBudget only stamps the month it runs in), which left months
// silently missing their mortgage/card payment.
//
// So instead of relying on stamping, each render asks the debt logic which
// debts owe a payment in this month. Debts with no instance yet are returned
// as PROJECTIONS - real rows are only created when something needs an id to
// point at (see materializeDebtLineItem), so merely paging through months
// doesn't write budget rows.
export interface ProjectedDebtItem {
  templateId: string;
  categoryGroupId: string;
  name: string;
  plannedAmountCents: number;
  dueDay: number | null;
  sortOrder: number;
}

// Planned amount for a debt in a given month, from its current terms - the
// same derivation linkDebtToBudget uses to seed the amount, so a projected
// row and a stamped one agree. Gross payment (principal + interest +
// escrow): that's the real monthly cash out.
export async function debtPlannedForMonth(
  accountId: string,
  balanceCents: number,
  month: string,
): Promise<{ plannedAmountCents: number; dueDay: number | null }> {
  const terms = await currentEffectiveTerms(accountId);
  if (!terms) return { plannedAmountCents: 0, dueDay: null };

  const simTerms = toSimTerms(terms);
  return {
    plannedAmountCents:
      (currentRequiredMonthlyCents(balanceCents, simTerms, month) ?? 0) +
      monthlyEscrowCents(simTerms),
    // A biweekly/weekly debt has no day-of-month; only monthly terms carry one.
    dueDay: terms.paymentFrequency === "monthly" ? terms.dueDay : null,
  };
}

// Debts that should appear in `month` but have no budget_line_item yet.
//
// Excluded: debts unlinked from the budget (template inactive), archived or
// deleted accounts, and anything already paid off (no balance left to pay).
// A linked debt with no terms yet still appears, at $0 - it's owed money the
// user hasn't described yet, and hiding it would make the link look broken.
export async function getProjectedDebtItems(
  householdId: string,
  month: string,
  stampedTemplateIds: Set<string>,
): Promise<ProjectedDebtItem[]> {
  // Past months are left exactly as they were budgeted at the time -
  // projecting into them would invent history that was never planned.
  if (month < currentMonthString()) return [];

  const rows = await db
    .select({ template: lineItemTemplates, account: accounts })
    .from(lineItemTemplates)
    .innerJoin(accounts, eq(lineItemTemplates.debtAccountId, accounts.id))
    .where(
      and(
        eq(lineItemTemplates.householdId, householdId),
        isNotNull(lineItemTemplates.debtAccountId),
        eq(lineItemTemplates.isActive, true),
        eq(accounts.isArchived, false),
      ),
    );

  const projected: ProjectedDebtItem[] = [];
  for (const { template, account } of rows) {
    if (stampedTemplateIds.has(template.id)) continue;

    const snapshot = await latestKnownBalance(account.id);
    const balanceCents = snapshot?.balanceCents ?? account.currentBalanceCents ?? 0;
    if (balanceCents <= 0) continue; // paid off - nothing left to pay

    const { plannedAmountCents, dueDay } = await debtPlannedForMonth(
      account.id,
      balanceCents,
      month,
    );
    projected.push({
      templateId: template.id,
      categoryGroupId: template.categoryGroupId,
      name: template.name,
      plannedAmountCents,
      dueDay,
      sortOrder: template.sortOrder,
    });
  }

  return projected.sort((a, b) => a.sortOrder - b.sortOrder);
}
