"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import { accountGroups } from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";

const renameSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export async function renameAccountGroup(groupId: string, formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = renameSchema.parse({ name: formData.get("name") });

  await db
    .update(accountGroups)
    .set({ name: input.name })
    .where(and(eq(accountGroups.id, groupId), eq(accountGroups.householdId, householdId)));

  revalidatePath("/accounts");
}

// Deleting a group only ungroups: accounts.accountGroupId is ON DELETE SET
// NULL, so members fall back to individual cards. Never touches accounts.
export async function deleteAccountGroup(groupId: string) {
  const householdId = await getCurrentHousehold();

  await db
    .delete(accountGroups)
    .where(and(eq(accountGroups.id, groupId), eq(accountGroups.householdId, householdId)));

  revalidatePath("/accounts");
}
