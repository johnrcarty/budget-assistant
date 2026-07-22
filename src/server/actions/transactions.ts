"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import { transactions } from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";
import { dollarsToCents } from "@/server/lib/money";
import { adjustAccountBalance } from "@/server/lib/account-balance";

// The category <Select> sends "none" (Base UI disallows empty values),
// "expense:<id>" for a budget line item, or "income:<id>" for an income
// item. Decoding sets exactly one of the two link columns - or neither -
// so a transaction can never point at both an expense and an income item.
const categoryField = z
  .string()
  .regex(/^(none|expense:[0-9a-f-]{36}|income:[0-9a-f-]{36})$/i)
  .optional();

function decodeCategory(value: string | undefined): {
  budgetLineItemId: string | null;
  incomeLineItemId: string | null;
} {
  if (!value || value === "none") return { budgetLineItemId: null, incomeLineItemId: null };
  const [kind, id] = value.split(":");
  return kind === "income"
    ? { budgetLineItemId: null, incomeLineItemId: id }
    : { budgetLineItemId: id, incomeLineItemId: null };
}

const createSchema = z.object({
  accountId: z.uuid(),
  type: z.enum(["expense", "income"]),
  amount: z.string().trim(),
  description: z.string().trim().min(1).max(200),
  postedDate: z.string(),
  category: categoryField,
  note: z.string().trim().max(2000).optional(),
});

export async function createTransaction(formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = createSchema.parse({
    accountId: formData.get("accountId"),
    type: formData.get("type"),
    amount: formData.get("amount") || "0",
    description: formData.get("description"),
    postedDate: formData.get("postedDate"),
    category: formData.get("category") || "none",
    note: formData.get("note") || undefined,
  });
  const links = decodeCategory(input.category);

  const magnitude = Math.abs(dollarsToCents(input.amount));
  const amountCents = input.type === "expense" ? -magnitude : magnitude;

  await db.transaction(async (tx) => {
    await tx.insert(transactions).values({
      householdId,
      accountId: input.accountId,
      amountCents,
      description: input.description,
      postedDate: input.postedDate,
      budgetLineItemId: links.budgetLineItemId,
      incomeLineItemId: links.incomeLineItemId,
      note: input.note || null,
      source: "manual",
    });

    await adjustAccountBalance(tx, input.accountId, amountCents);
  });

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/budget/income");
  revalidatePath("/accounts");
}

const updateSchema = z.object({
  type: z.enum(["expense", "income"]),
  amount: z.string().trim(),
  description: z.string().trim().min(1).max(200),
  postedDate: z.string(),
  category: categoryField,
  note: z.string().trim().max(2000).optional(),
});

export async function updateTransaction(transactionId: string, formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = updateSchema.parse({
    type: formData.get("type"),
    amount: formData.get("amount") || "0",
    description: formData.get("description"),
    postedDate: formData.get("postedDate"),
    category: formData.get("category") || "none",
    note: formData.get("note") || undefined,
  });
  const links = decodeCategory(input.category);

  const magnitude = Math.abs(dollarsToCents(input.amount));
  const newAmountCents = input.type === "expense" ? -magnitude : magnitude;

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.householdId, householdId),
        ),
      )
      .limit(1);

    if (!existing) return;

    await tx
      .update(transactions)
      .set({
        amountCents: newAmountCents,
        description: input.description,
        postedDate: input.postedDate,
        budgetLineItemId: links.budgetLineItemId,
        incomeLineItemId: links.incomeLineItemId,
        note: input.note || null,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transactionId));

    const delta = newAmountCents - existing.amountCents;
    await adjustAccountBalance(tx, existing.accountId, delta);
  });

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/budget/income");
  revalidatePath("/accounts");
}

export async function deleteTransaction(transactionId: string) {
  const householdId = await getCurrentHousehold();

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.householdId, householdId),
        ),
      )
      .limit(1);

    if (!existing) return;

    await tx.delete(transactions).where(eq(transactions.id, transactionId));
    await adjustAccountBalance(tx, existing.accountId, -existing.amountCents);
  });

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/budget/income");
  revalidatePath("/accounts");
}
