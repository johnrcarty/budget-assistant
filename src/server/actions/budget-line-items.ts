"use server";

import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/server/db/client";
import {
  budgetLineItems,
  budgetMonths,
  categoryGroups,
  lineItemTemplates,
} from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";
import { getIngressPath } from "@/server/lib/ingress";
import { dollarsToCents } from "@/server/lib/money";
import { firstOfMonth, getOrCreateBudgetMonth } from "@/server/db/queries/budget";

const createSchema = z.object({
  categoryGroupId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  plannedAmount: z.string().trim(),
  month: z.string(), // YYYY-MM-01, the month currently being viewed
});

// "Add Item" creates both the recurring template and this month's instance -
// EveryDollar-style category items are recurring by default.
export async function createLineItem(formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = createSchema.parse({
    categoryGroupId: formData.get("categoryGroupId"),
    name: formData.get("name"),
    plannedAmount: formData.get("plannedAmount") || "0",
    month: formData.get("month"),
  });
  const plannedAmountCents = dollarsToCents(input.plannedAmount);

  const [targetGroup] = await db
    .select({ id: categoryGroups.id })
    .from(categoryGroups)
    .where(
      and(
        eq(categoryGroups.id, input.categoryGroupId),
        eq(categoryGroups.householdId, householdId),
      ),
    )
    .limit(1);
  if (!targetGroup) throw new Error("Unknown category group");

  const [lastTemplate] = await db
    .select({ sortOrder: lineItemTemplates.sortOrder })
    .from(lineItemTemplates)
    .where(eq(lineItemTemplates.categoryGroupId, input.categoryGroupId))
    .orderBy(desc(lineItemTemplates.sortOrder))
    .limit(1);
  const sortOrder = (lastTemplate?.sortOrder ?? 0) + 1;

  const [template] = await db
    .insert(lineItemTemplates)
    .values({
      householdId,
      categoryGroupId: input.categoryGroupId,
      name: input.name,
      defaultPlannedAmountCents: plannedAmountCents,
      sortOrder,
    })
    .returning();

  const budgetMonth = await getOrCreateBudgetMonth(householdId, input.month);

  await db.insert(budgetLineItems).values({
    householdId,
    budgetMonthId: budgetMonth.id,
    categoryGroupId: input.categoryGroupId,
    templateItemId: template.id,
    name: input.name,
    plannedAmountCents,
    sortOrder,
  });

  revalidatePath("/budget");
}

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  plannedAmount: z.string().trim().optional(),
  dueDay: z.coerce.number().int().min(1).max(31).optional().or(z.literal("")),
  note: z.string().trim().max(2000).optional(),
  fundTarget: z.string().trim().optional(),
  // Not z.coerce.boolean() - Boolean("false") is true in JS, which would
  // make unchecking the Favorite switch silently save it as still favorited.
  isFavorite: z.enum(["true", "false"]).optional(),
  categoryGroupId: z.uuid().optional(),
});

export async function updateLineItem(lineItemId: string, formData: FormData) {
  const householdId = await getCurrentHousehold();
  const raw = Object.fromEntries(formData.entries());
  const input = updateSchema.parse(raw);

  const updates: Partial<typeof budgetLineItems.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) updates.name = input.name;
  if (input.plannedAmount !== undefined) {
    updates.plannedAmountCents = dollarsToCents(input.plannedAmount);
  }
  if (input.dueDay !== undefined) {
    updates.dueDay = input.dueDay === "" ? null : input.dueDay;
  }
  if (input.note !== undefined) updates.note = input.note || null;
  if (input.fundTarget !== undefined) {
    updates.fundTargetCents = input.fundTarget
      ? dollarsToCents(input.fundTarget)
      : null;
  }
  if (input.isFavorite !== undefined) {
    updates.isFavorite = input.isFavorite === "true";
  }

  let newCategoryGroupId: string | undefined;
  if (input.categoryGroupId !== undefined) {
    const [targetGroup] = await db
      .select({ id: categoryGroups.id })
      .from(categoryGroups)
      .where(
        and(
          eq(categoryGroups.id, input.categoryGroupId),
          eq(categoryGroups.householdId, householdId),
        ),
      )
      .limit(1);
    if (targetGroup) {
      updates.categoryGroupId = targetGroup.id;
      newCategoryGroupId = targetGroup.id;
    }
  }

  const [existing] = await db
    .select({ templateItemId: budgetLineItems.templateItemId })
    .from(budgetLineItems)
    .where(
      and(
        eq(budgetLineItems.id, lineItemId),
        eq(budgetLineItems.householdId, householdId),
      ),
    )
    .limit(1);
  if (!existing) return;

  await db
    .update(budgetLineItems)
    .set(updates)
    .where(
      and(
        eq(budgetLineItems.id, lineItemId),
        eq(budgetLineItems.householdId, householdId),
      ),
    );

  // Move the recurring template too, so future months stamp into the new
  // group as well - a category change is a structural correction, not a
  // month-specific value like the planned amount or due day.
  if (newCategoryGroupId && existing.templateItemId) {
    await db
      .update(lineItemTemplates)
      .set({ categoryGroupId: newCategoryGroupId })
      .where(eq(lineItemTemplates.id, existing.templateItemId));
  }

  revalidatePath("/budget");
  revalidatePath(`/budget/item/${lineItemId}`);
}

// Removes the item from this month and stops it recurring into future
// months. Past months already stamped are untouched.
export async function deleteLineItem(lineItemId: string) {
  const householdId = await getCurrentHousehold();

  const [item] = await db
    .select({
      templateItemId: budgetLineItems.templateItemId,
      month: budgetMonths.month,
    })
    .from(budgetLineItems)
    .innerJoin(budgetMonths, eq(budgetLineItems.budgetMonthId, budgetMonths.id))
    .where(
      and(
        eq(budgetLineItems.id, lineItemId),
        eq(budgetLineItems.householdId, householdId),
      ),
    )
    .limit(1);

  if (!item) return;

  await db.delete(budgetLineItems).where(eq(budgetLineItems.id, lineItemId));

  if (item.templateItemId) {
    await db
      .update(lineItemTemplates)
      .set({ isActive: false })
      .where(eq(lineItemTemplates.id, item.templateItemId));
  }

  revalidatePath("/budget");
  redirect(`${await getIngressPath()}/budget?month=${item.month}`);
}

export { firstOfMonth };
