"use server";

import { revalidatePath } from "next/cache";
import { getCurrentHousehold } from "@/server/lib/dal";
import {
  copyMonthBudget,
  getMostRecentMonthWithBudget,
  getOrCreateBudgetMonth,
} from "@/server/db/queries/budget";
import { ensureScheduledIncomeForMonth } from "@/server/db/queries/income-schedules";

// The "Create <Month> Budget" button - user-initiated copy of the most
// recent prior month that actually has a budget. No-ops if there's nothing
// to copy from (the household's very first month). Schedule-driven income
// groups are stamped from their pay schedule rather than copied, so 3-check
// months plan 3 checks.
export async function copyPreviousMonthBudget(month: string) {
  const householdId = await getCurrentHousehold();

  const sourceMonth = await getMostRecentMonthWithBudget(householdId, month);
  if (!sourceMonth) return;

  const targetMonth = await getOrCreateBudgetMonth(householdId, month);
  await copyMonthBudget(householdId, sourceMonth.id, targetMonth.id);
  await ensureScheduledIncomeForMonth(householdId, targetMonth.id, month);

  revalidatePath("/budget");
}
