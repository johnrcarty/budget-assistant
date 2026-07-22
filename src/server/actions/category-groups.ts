"use server";

import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import { categoryGroups } from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";

const nameSchema = z.string().trim().min(1).max(80);

export async function createCategoryGroup(formData: FormData) {
  const householdId = await getCurrentHousehold();
  const name = nameSchema.parse(formData.get("name"));

  const [lastGroup] = await db
    .select({ sortOrder: categoryGroups.sortOrder })
    .from(categoryGroups)
    .where(eq(categoryGroups.householdId, householdId))
    .orderBy(desc(categoryGroups.sortOrder))
    .limit(1);

  await db.insert(categoryGroups).values({
    householdId,
    name,
    sortOrder: (lastGroup?.sortOrder ?? 0) + 1,
  });

  revalidatePath("/budget");
}

export async function renameCategoryGroup(
  categoryGroupId: string,
  formData: FormData,
) {
  const householdId = await getCurrentHousehold();
  const name = nameSchema.parse(formData.get("name"));

  await db
    .update(categoryGroups)
    .set({ name })
    .where(
      and(
        eq(categoryGroups.id, categoryGroupId),
        eq(categoryGroups.householdId, householdId),
      ),
    );

  revalidatePath("/budget");
}

export async function archiveCategoryGroup(categoryGroupId: string) {
  const householdId = await getCurrentHousehold();

  // System-managed groups (the Debt section) are permanent once created -
  // the UI hides the control, and this guard backs it up.
  await db
    .update(categoryGroups)
    .set({ isArchived: true })
    .where(
      and(
        eq(categoryGroups.id, categoryGroupId),
        eq(categoryGroups.householdId, householdId),
        isNull(categoryGroups.systemKey),
      ),
    );

  revalidatePath("/budget");
}
