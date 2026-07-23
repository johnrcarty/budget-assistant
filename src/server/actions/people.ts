"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import { persons, personTypeEnum } from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";

const CHART_COLOR_TOKENS = new Set(
  Array.from({ length: 8 }, (_, i) => `chart-${i + 1}`),
);

const personSchema = z.object({
  name: z.string().trim().min(1).max(80),
  personType: z.enum(personTypeEnum.enumValues),
  color: z
    .string()
    .optional()
    .transform((v) => (v && CHART_COLOR_TOKENS.has(v) ? v : null)),
});

export async function createPerson(formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = personSchema.parse({
    name: formData.get("name"),
    personType: formData.get("personType"),
    color: formData.get("color") || undefined,
  });

  await db.insert(persons).values({ householdId, ...input });

  revalidatePath("/settings/people");
  revalidatePath("/accounts");
  revalidatePath("/income");
  revalidatePath("/budget/income");
}

export async function updatePerson(personId: string, formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = personSchema.parse({
    name: formData.get("name"),
    personType: formData.get("personType"),
    color: formData.get("color") || undefined,
  });

  await db
    .update(persons)
    .set(input)
    .where(and(eq(persons.id, personId), eq(persons.householdId, householdId)));

  revalidatePath("/settings/people");
  revalidatePath("/accounts");
  revalidatePath("/income");
  revalidatePath("/budget/income");
}

// Persons are never hard-deleted - income/account history references them.
// Archiving always succeeds; the UI is responsible for warning about linked
// data before the user confirms.
export async function archivePerson(personId: string) {
  const householdId = await getCurrentHousehold();

  await db
    .update(persons)
    .set({ isActive: false })
    .where(and(eq(persons.id, personId), eq(persons.householdId, householdId)));

  revalidatePath("/settings/people");
}

export async function unarchivePerson(personId: string) {
  const householdId = await getCurrentHousehold();

  await db
    .update(persons)
    .set({ isActive: true })
    .where(and(eq(persons.id, personId), eq(persons.householdId, householdId)));

  revalidatePath("/settings/people");
}
