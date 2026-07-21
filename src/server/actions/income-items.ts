"use server";

import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import { incomeLineItems, incomeTemplates } from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";
import { dollarsToCents } from "@/server/lib/money";
import { getOrCreateBudgetMonth } from "@/server/db/queries/budget";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  plannedAmount: z.string().trim(),
  month: z.string(),
});

export async function createIncomeItem(formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = createSchema.parse({
    name: formData.get("name"),
    plannedAmount: formData.get("plannedAmount") || "0",
    month: formData.get("month"),
  });
  const plannedAmountCents = dollarsToCents(input.plannedAmount);

  const [lastTemplate] = await db
    .select({ sortOrder: incomeTemplates.sortOrder })
    .from(incomeTemplates)
    .where(eq(incomeTemplates.householdId, householdId))
    .orderBy(desc(incomeTemplates.sortOrder))
    .limit(1);
  const sortOrder = (lastTemplate?.sortOrder ?? 0) + 1;

  const [template] = await db
    .insert(incomeTemplates)
    .values({
      householdId,
      name: input.name,
      defaultAmountCents: plannedAmountCents,
      sortOrder,
    })
    .returning();

  const budgetMonth = await getOrCreateBudgetMonth(householdId, input.month);

  await db.insert(incomeLineItems).values({
    householdId,
    budgetMonthId: budgetMonth.id,
    templateItemId: template.id,
    name: input.name,
    plannedAmountCents,
    sortOrder,
  });

  revalidatePath("/budget");
  revalidatePath("/budget/income");
}

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  plannedAmount: z.string().trim().optional(),
});

export async function updateIncomeItem(
  incomeItemId: string,
  formData: FormData,
) {
  const householdId = await getCurrentHousehold();
  const input = updateSchema.parse(Object.fromEntries(formData.entries()));

  const updates: Partial<typeof incomeLineItems.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) updates.name = input.name;
  if (input.plannedAmount !== undefined) {
    updates.plannedAmountCents = dollarsToCents(input.plannedAmount);
  }

  await db
    .update(incomeLineItems)
    .set(updates)
    .where(
      and(
        eq(incomeLineItems.id, incomeItemId),
        eq(incomeLineItems.householdId, householdId),
      ),
    );

  revalidatePath("/budget");
  revalidatePath("/budget/income");
}

export async function deleteIncomeItem(incomeItemId: string) {
  const householdId = await getCurrentHousehold();

  const [item] = await db
    .select({ templateItemId: incomeLineItems.templateItemId })
    .from(incomeLineItems)
    .where(
      and(
        eq(incomeLineItems.id, incomeItemId),
        eq(incomeLineItems.householdId, householdId),
      ),
    )
    .limit(1);

  if (!item) return;

  await db.delete(incomeLineItems).where(eq(incomeLineItems.id, incomeItemId));

  if (item.templateItemId) {
    await db
      .update(incomeTemplates)
      .set({ isActive: false })
      .where(eq(incomeTemplates.id, item.templateItemId));
  }

  revalidatePath("/budget");
  revalidatePath("/budget/income");
}
