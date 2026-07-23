"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import { transactions, budgetLineItems, incomeLineItems } from "@/server/db/schema";
import {
  bulkSetTransactionCategory,
  type TransactionWhereFilters,
} from "@/server/db/queries/transactions";
import { getCurrentHousehold } from "@/server/lib/dal";
import { dollarsToCents } from "@/server/lib/money";
import { adjustAccountBalance } from "@/server/lib/account-balance";

// The category <Select> sends "none" (Base UI disallows empty values),
// "expense:<id>" for a budget line item, "income:<id>" for an income item,
// or "transfer" for money moved between own accounts. Decoding sets at most
// one of the two link columns and the transfer flag exclusively, so a
// transaction can never be two of those things at once.
const CATEGORY_PATTERN = /^(none|transfer|expense:[0-9a-f-]{36}|income:[0-9a-f-]{36})$/i;
const categoryField = z.string().regex(CATEGORY_PATTERN).optional();

function decodeCategory(value: string | undefined): {
  budgetLineItemId: string | null;
  incomeLineItemId: string | null;
  isTransfer: boolean;
} {
  if (!value || value === "none") {
    return { budgetLineItemId: null, incomeLineItemId: null, isTransfer: false };
  }
  if (value === "transfer") {
    return { budgetLineItemId: null, incomeLineItemId: null, isTransfer: true };
  }
  const [kind, id] = value.split(":");
  return kind === "income"
    ? { budgetLineItemId: null, incomeLineItemId: id, isTransfer: false }
    : { budgetLineItemId: id, incomeLineItemId: null, isTransfer: false };
}

// The target line item / income source must belong to this household -
// otherwise a tampered category value could link a transaction to another
// household's budget row.
async function verifyCategoryLinks(
  householdId: string,
  links: { budgetLineItemId: string | null; incomeLineItemId: string | null },
) {
  if (links.budgetLineItemId) {
    const [item] = await db
      .select({ id: budgetLineItems.id })
      .from(budgetLineItems)
      .where(
        and(
          eq(budgetLineItems.id, links.budgetLineItemId),
          eq(budgetLineItems.householdId, householdId),
        ),
      )
      .limit(1);
    if (!item) throw new Error("Unknown budget line item");
  }
  if (links.incomeLineItemId) {
    const [item] = await db
      .select({ id: incomeLineItems.id })
      .from(incomeLineItems)
      .where(
        and(
          eq(incomeLineItems.id, links.incomeLineItemId),
          eq(incomeLineItems.householdId, householdId),
        ),
      )
      .limit(1);
    if (!item) throw new Error("Unknown income source");
  }
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
  await verifyCategoryLinks(householdId, links);

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
      isTransfer: links.isTransfer,
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
  await verifyCategoryLinks(householdId, links);

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
        isTransfer: links.isTransfer,
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

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// The filter set the transactions page computed server-side, echoed back by
// the client. Every condition is additionally scoped to the session's
// household, so a tampered filter can only re-slice the household's own
// transactions.
const bulkFiltersSchema = z.object({
  search: z.string().max(200).optional(),
  accountIds: z.array(z.uuid()).max(100).optional(),
  startDate: z.string().regex(ISO_DATE_PATTERN).optional(),
  endDate: z.string().regex(ISO_DATE_PATTERN).optional(),
  pending: z.boolean().optional(),
  categorized: z.boolean().optional(),
  direction: z.enum(["income", "expense"]).optional(),
  minAmountCents: z.number().int().nonnegative().optional(),
  maxAmountCents: z.number().int().nonnegative().optional(),
  flow: z.string().max(200).optional(),
});

// Applies one category to every transaction matching the given filters
// (all pages, not just the visible one). Returns the number updated.
export async function bulkCategorizeTransactions(
  rawFilters: TransactionWhereFilters,
  rawCategory: string,
): Promise<number> {
  const householdId = await getCurrentHousehold();
  const filters = bulkFiltersSchema.parse(rawFilters);
  const category = z.string().regex(CATEGORY_PATTERN).parse(rawCategory);
  const links = decodeCategory(category);
  await verifyCategoryLinks(householdId, links);

  const updatedCount = await bulkSetTransactionCategory(householdId, filters, links);

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/budget/income");
  revalidatePath("/accounts");

  return updatedCount;
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
