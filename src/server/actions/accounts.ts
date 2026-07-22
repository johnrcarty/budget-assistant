"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import { accounts, accountKindEnum, lineItemTemplates } from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";
import { dollarsToCents } from "@/server/lib/money";

const LIABILITY_KINDS = new Set(["credit_card", "loan", "line_of_credit"]);

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(accountKindEnum.enumValues),
  startingBalance: z.string().trim(),
});

export async function createAccount(formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = createSchema.parse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    startingBalance: formData.get("startingBalance") || "0",
  });

  await db.insert(accounts).values({
    householdId,
    name: input.name,
    kind: input.kind,
    isLiability: LIABILITY_KINDS.has(input.kind),
    currentBalanceCents: dollarsToCents(input.startingBalance),
    balanceAsOf: new Date(),
  });

  revalidatePath("/accounts");
  revalidatePath("/transactions");
}

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(accountKindEnum.enumValues),
});

// Edits name/kind. isLiability follows the kind - fixing a 401k that was
// created as "checking" to "investment" is the motivating case.
export async function updateAccount(accountId: string, formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = updateSchema.parse({
    name: formData.get("name"),
    kind: formData.get("kind"),
  });
  const isLiability = LIABILITY_KINDS.has(input.kind);

  await db
    .update(accounts)
    .set({ name: input.name, kind: input.kind, isLiability })
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)));

  // If a debt became a non-liability, its linked budget item should stop
  // stamping into future months (same rule as archiving).
  if (!isLiability) {
    await db
      .update(lineItemTemplates)
      .set({ isActive: false })
      .where(
        and(
          eq(lineItemTemplates.debtAccountId, accountId),
          eq(lineItemTemplates.householdId, householdId),
        ),
      );
  }

  revalidatePath("/accounts");
  revalidatePath("/debt");
  revalidatePath("/transactions");
}

export async function archiveAccount(accountId: string) {
  const householdId = await getCurrentHousehold();

  await db
    .update(accounts)
    .set({ isArchived: true })
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)));

  // An archived debt should stop stamping its payment into future budget
  // months. Current/past months are untouched.
  await db
    .update(lineItemTemplates)
    .set({ isActive: false })
    .where(
      and(
        eq(lineItemTemplates.debtAccountId, accountId),
        eq(lineItemTemplates.householdId, householdId),
      ),
    );

  revalidatePath("/accounts");
  revalidatePath("/debt");
}

export async function unarchiveAccount(accountId: string) {
  const householdId = await getCurrentHousehold();

  await db
    .update(accounts)
    .set({ isArchived: false })
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)));

  revalidatePath("/accounts");
  revalidatePath("/debt");
}
