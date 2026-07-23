"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentHousehold } from "@/server/lib/dal";
import { dollarsToCents } from "@/server/lib/money";
import { isPayFrequency } from "@/lib/income-schedule";
import { getOrCreateBudgetMonth } from "@/server/db/queries/budget";
import { getPerson } from "@/server/db/queries/people";
import {
  deleteIncomeSchedule as deleteScheduleRow,
  ensureScheduledIncomeForMonth,
  upsertIncomeSchedule,
} from "@/server/db/queries/income-schedules";

const saveSchema = z
  .object({
    personId: z.string().uuid(),
    frequency: z.string().refine(isPayFrequency, "Unknown frequency"),
    anchorDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    secondDayOfMonth: z.coerce.number().int().min(1).max(31).nullable(),
    perCheckAmount: z.string().trim(),
    month: z.string().regex(/^\d{4}-\d{2}-01$/),
  })
  .refine((input) => input.frequency === "irregular" || input.anchorDate, {
    message: "A known check date is required",
    path: ["anchorDate"],
  });

export async function saveIncomeSchedule(formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = saveSchema.parse({
    personId: formData.get("personId"),
    frequency: formData.get("frequency"),
    anchorDate: formData.get("anchorDate") || null,
    secondDayOfMonth: formData.get("secondDayOfMonth") || null,
    month: formData.get("month"),
    perCheckAmount: formData.get("perCheckAmount") || "0",
  });

  const person = await getPerson(householdId, input.personId);
  if (!person) throw new Error("Unknown person");

  await upsertIncomeSchedule(householdId, {
    personId: input.personId,
    frequency: input.frequency,
    anchorDate: input.anchorDate,
    secondDayOfMonth: input.frequency === "semimonthly" ? input.secondDayOfMonth : null,
    perCheckAmountCents: dollarsToCents(input.perCheckAmount),
  });

  // Materialize/top-up the month being viewed right away, so a schedule
  // saved mid-month is reflected without waiting for month creation.
  const budgetMonth = await getOrCreateBudgetMonth(householdId, input.month);
  await ensureScheduledIncomeForMonth(householdId, budgetMonth.id, input.month);

  revalidatePath("/budget");
  revalidatePath("/budget/income");
}

export async function deleteIncomeSchedule(scheduleId: string) {
  const householdId = await getCurrentHousehold();
  await deleteScheduleRow(householdId, scheduleId);
  revalidatePath("/budget");
  revalidatePath("/budget/income");
}
