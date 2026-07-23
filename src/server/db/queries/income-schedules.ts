import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { incomeLineItems, incomeSchedules, incomeTemplates, persons } from "@/server/db/schema";
import { buildSlotGroups } from "@/lib/income-slots";
import {
  checkDatesInMonth,
  type PayFrequency,
  type ScheduleSpec,
} from "@/lib/income-schedule";

export type IncomeSchedule = typeof incomeSchedules.$inferSelect;

export async function getIncomeSchedules(householdId: string) {
  return db
    .select()
    .from(incomeSchedules)
    .where(eq(incomeSchedules.householdId, householdId));
}

// A schedule only stamps line items when it can produce dates.
export function scheduleSpec(schedule: IncomeSchedule): ScheduleSpec {
  return {
    frequency: schedule.frequency as PayFrequency,
    anchorDate: schedule.anchorDate,
    secondDayOfMonth: schedule.secondDayOfMonth,
  };
}

export function scheduleStamps(schedule: IncomeSchedule): boolean {
  return schedule.frequency !== "irregular" && schedule.anchorDate !== null;
}

export async function upsertIncomeSchedule(
  householdId: string,
  input: {
    personId: string;
    frequency: PayFrequency;
    anchorDate: string | null;
    secondDayOfMonth: number | null;
    perCheckAmountCents: number;
  },
) {
  const [schedule] = await db
    .insert(incomeSchedules)
    .values({ householdId, ...input })
    .onConflictDoUpdate({
      target: [incomeSchedules.householdId, incomeSchedules.personId],
      set: {
        frequency: input.frequency,
        anchorDate: input.anchorDate,
        secondDayOfMonth: input.secondDayOfMonth,
        perCheckAmountCents: input.perCheckAmountCents,
        updatedAt: new Date(),
      },
    })
    .returning();
  return schedule;
}

export async function deleteIncomeSchedule(householdId: string, scheduleId: string) {
  await db
    .delete(incomeSchedules)
    .where(
      and(eq(incomeSchedules.id, scheduleId), eq(incomeSchedules.householdId, householdId)),
    );
}

// Idempotent top-up: for each schedule that can stamp, ensure the month has
// one line item per expected check - minting extra slot templates when a
// 3-check month needs one. Never deletes line items or edits planned
// amounts, so manual edits and mid-month removals stick. Months with more
// items than expected checks are left alone.
export async function ensureScheduledIncomeForMonth(
  householdId: string,
  budgetMonthId: string,
  month: string, // YYYY-MM-01
): Promise<{ createdItems: number; mintedTemplates: number }> {
  const schedules = (await getIncomeSchedules(householdId)).filter(scheduleStamps);
  if (schedules.length === 0) return { createdItems: 0, mintedTemplates: 0 };

  const activeTemplates = await db
    .select()
    .from(incomeTemplates)
    .where(
      and(eq(incomeTemplates.householdId, householdId), eq(incomeTemplates.isActive, true)),
    );
  const groups = buildSlotGroups(activeTemplates);

  const monthItems = await db
    .select()
    .from(incomeLineItems)
    .where(eq(incomeLineItems.budgetMonthId, budgetMonthId));
  const itemsByTemplate = new Map(
    monthItems.filter((i) => i.templateItemId).map((i) => [i.templateItemId!, i]),
  );

  let createdItems = 0;
  let mintedTemplates = 0;

  for (const schedule of schedules) {
    const dates = checkDatesInMonth(scheduleSpec(schedule), month);
    if (dates.length === 0) continue;

    // A schedule whose person has no active templates left stamps nothing.
    const members = [...(groups.get(schedule.personId) ?? [])];
    if (members.length === 0) continue;

    if (members.length < dates.length) {
      const [person] = await db
        .select({ name: persons.name })
        .from(persons)
        .where(eq(persons.id, schedule.personId))
        .limit(1);
      const personName = person?.name ?? "Income";

      while (members.length < dates.length) {
        const slotNumber = members.length + 1;
        const [{ maxSort }] = await db
          .select({ maxSort: sql<number>`coalesce(max(${incomeTemplates.sortOrder}), 0)` })
          .from(incomeTemplates)
          .where(eq(incomeTemplates.householdId, householdId));
        const [minted] = await db
          .insert(incomeTemplates)
          .values({
            householdId,
            personId: schedule.personId,
            slotNumber,
            name: `${personName} ${slotNumber}`,
            defaultAmountCents: schedule.perCheckAmountCents,
            sortOrder: Number(maxSort) + 1,
          })
          .returning();
        members.push(minted);
        mintedTemplates++;
      }
    }

    for (let i = 0; i < dates.length && i < members.length; i++) {
      const existing = itemsByTemplate.get(members[i].id);
      if (existing) {
        if (!existing.expectedDate) {
          await db
            .update(incomeLineItems)
            .set({ expectedDate: dates[i], updatedAt: new Date() })
            .where(eq(incomeLineItems.id, existing.id));
        }
        continue;
      }
      await db.insert(incomeLineItems).values({
        householdId,
        budgetMonthId,
        templateItemId: members[i].id,
        name: members[i].name,
        plannedAmountCents: schedule.perCheckAmountCents,
        expectedDate: dates[i],
        sortOrder: members[i].sortOrder,
      });
      createdItems++;
    }
  }

  return { createdItems, mintedTemplates };
}

// Person ids whose schedules stamp line items - copyMonthBudget skips these
// so schedule-driven groups get the correct slot count for the target month
// instead of a clone of the source month's.
export async function getStampingSchedulePersonIds(householdId: string): Promise<Set<string>> {
  const schedules = await getIncomeSchedules(householdId);
  return new Set(schedules.filter(scheduleStamps).map((s) => s.personId));
}

export async function getActiveIncomeTemplates(householdId: string) {
  return db
    .select()
    .from(incomeTemplates)
    .where(
      and(eq(incomeTemplates.householdId, householdId), eq(incomeTemplates.isActive, true)),
    )
    .orderBy(asc(incomeTemplates.sortOrder));
}
