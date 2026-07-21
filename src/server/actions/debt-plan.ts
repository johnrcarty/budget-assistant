"use server";

import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import {
  accounts,
  budgetLineItems,
  categoryGroups,
  debtPlans,
  lineItemTemplates,
} from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";
import { dollarsToCents } from "@/server/lib/money";
import { currentRequiredMonthlyCents } from "@/server/lib/debt-sim";
import { currentEffectiveTerms, latestKnownBalance, toSimTerms } from "@/server/db/queries/debt";
import { getBudgetMonth, getOrCreateBudgetMonth } from "@/server/db/queries/budget";
import { currentMonthString } from "@/lib/month";

const settingsSchema = z.object({
  strategy: z.enum(["snowball", "avalanche"]),
  extraMonthly: z.string().trim(),
});

export async function updateDebtPlanSettings(formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = settingsSchema.parse({
    strategy: formData.get("strategy"),
    extraMonthly: formData.get("extraMonthly") || "0",
  });
  const extraMonthlyCents = Math.max(0, dollarsToCents(input.extraMonthly));

  await db
    .insert(debtPlans)
    .values({ householdId, strategy: input.strategy, extraMonthlyCents })
    .onConflictDoUpdate({
      target: debtPlans.householdId,
      set: { strategy: input.strategy, extraMonthlyCents, updatedAt: new Date() },
    });

  revalidatePath("/debt");
}

// The app-managed "Debt" category group, identified by systemKey (survives
// renames). Created on first link.
async function getOrCreateDebtGroup(householdId: string) {
  const [existing] = await db
    .select()
    .from(categoryGroups)
    .where(
      and(eq(categoryGroups.householdId, householdId), eq(categoryGroups.systemKey, "debt")),
    )
    .limit(1);
  if (existing) {
    if (existing.isArchived) {
      await db
        .update(categoryGroups)
        .set({ isArchived: false })
        .where(eq(categoryGroups.id, existing.id));
    }
    return existing;
  }

  const [last] = await db
    .select({ sortOrder: categoryGroups.sortOrder })
    .from(categoryGroups)
    .where(eq(categoryGroups.householdId, householdId))
    .orderBy(desc(categoryGroups.sortOrder))
    .limit(1);

  const [created] = await db
    .insert(categoryGroups)
    .values({
      householdId,
      name: "Debt",
      systemKey: "debt",
      sortOrder: (last?.sortOrder ?? 0) + 1,
    })
    .returning();
  return created;
}

// Creates (or reactivates) the budget line item that represents this debt's
// monthly payment, inside the managed Debt group. Planned amount seeds from
// the current required payment as a monthly equivalent - a $100 biweekly
// payment budgets as $216.67/mo, since the budget is monthly.
export async function linkDebtToBudget(accountId: string) {
  const householdId = await getCurrentHousehold();

  const [account] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.householdId, householdId),
        eq(accounts.isLiability, true),
      ),
    )
    .limit(1);
  if (!account) return;

  const [group, terms, balance] = await Promise.all([
    getOrCreateDebtGroup(householdId),
    currentEffectiveTerms(accountId),
    latestKnownBalance(accountId),
  ]);

  const month = currentMonthString();
  const balanceCents = balance?.balanceCents ?? account.currentBalanceCents ?? 0;
  const plannedCents = terms
    ? (currentRequiredMonthlyCents(balanceCents, toSimTerms(terms), month) ?? 0)
    : 0;
  // A biweekly/weekly debt has no day-of-month; only monthly terms carry one.
  const dueDay = terms && terms.paymentFrequency === "monthly" ? terms.dueDay : null;

  const [existingTemplate] = await db
    .select()
    .from(lineItemTemplates)
    .where(eq(lineItemTemplates.debtAccountId, accountId))
    .limit(1);

  let template = existingTemplate;
  if (existingTemplate) {
    [template] = await db
      .update(lineItemTemplates)
      .set({
        isActive: true,
        name: account.name,
        categoryGroupId: group.id,
        defaultPlannedAmountCents: plannedCents,
        dueDay,
      })
      .where(eq(lineItemTemplates.id, existingTemplate.id))
      .returning();
  } else {
    const [last] = await db
      .select({ sortOrder: lineItemTemplates.sortOrder })
      .from(lineItemTemplates)
      .where(eq(lineItemTemplates.categoryGroupId, group.id))
      .orderBy(desc(lineItemTemplates.sortOrder))
      .limit(1);
    [template] = await db
      .insert(lineItemTemplates)
      .values({
        householdId,
        categoryGroupId: group.id,
        debtAccountId: accountId,
        name: account.name,
        defaultPlannedAmountCents: plannedCents,
        dueDay,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      })
      .returning();
  }

  // Stamp this month's instance (user-initiated, so creating the budget
  // month here is fine). Idempotent: skip if already stamped.
  const budgetMonth = await getOrCreateBudgetMonth(householdId, month);
  const [existingInstance] = await db
    .select({ id: budgetLineItems.id })
    .from(budgetLineItems)
    .where(
      and(
        eq(budgetLineItems.budgetMonthId, budgetMonth.id),
        eq(budgetLineItems.templateItemId, template.id),
      ),
    )
    .limit(1);
  if (!existingInstance) {
    await db.insert(budgetLineItems).values({
      householdId,
      budgetMonthId: budgetMonth.id,
      categoryGroupId: group.id,
      templateItemId: template.id,
      name: account.name,
      plannedAmountCents: plannedCents,
      dueDay,
      sortOrder: template.sortOrder,
    });
  }

  revalidatePath("/budget");
  revalidatePath("/debt");
  revalidatePath(`/accounts/${accountId}`);
}

// Deactivates the linked item (future months stop stamping it) and removes
// it from the current month. Past months are untouched; the template keeps
// its debtAccountId so re-linking reactivates the same row.
export async function unlinkDebtFromBudget(accountId: string) {
  const householdId = await getCurrentHousehold();

  const [template] = await db
    .select()
    .from(lineItemTemplates)
    .where(
      and(
        eq(lineItemTemplates.debtAccountId, accountId),
        eq(lineItemTemplates.householdId, householdId),
      ),
    )
    .limit(1);
  if (!template) return;

  await db
    .update(lineItemTemplates)
    .set({ isActive: false })
    .where(eq(lineItemTemplates.id, template.id));

  const budgetMonth = await getBudgetMonth(householdId, currentMonthString());
  if (budgetMonth) {
    await db
      .delete(budgetLineItems)
      .where(
        and(
          eq(budgetLineItems.budgetMonthId, budgetMonth.id),
          eq(budgetLineItems.templateItemId, template.id),
        ),
      );
  }

  revalidatePath("/budget");
  revalidatePath("/debt");
  revalidatePath(`/accounts/${accountId}`);
}
