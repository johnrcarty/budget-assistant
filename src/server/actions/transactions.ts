"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import { transactions, lineItemTemplates, incomeTemplates } from "@/server/db/schema";
import {
  bulkSetTransactionCategory,
  deleteTransactionById,
  type CategoryTarget,
  type TransactionWhereFilters,
} from "@/server/db/queries/transactions";
import {
  ensureLineItemInstance,
  applyIncomeSlotAssignments,
} from "@/server/db/queries/line-item-instances";
import { getCurrentHousehold } from "@/server/lib/dal";
import { dollarsToCents } from "@/server/lib/money";
import { adjustAccountBalance } from "@/server/lib/account-balance";

// The category <Select> sends "none" (Base UI disallows empty values),
// "expense:<id>" for a line item TEMPLATE, "income:<id>" for an income
// TEMPLATE, or "transfer" for money moved between own accounts. A category
// choice is never a specific month's instance - the instance for this
// transaction's OWN month is resolved (or created) at write time, so
// categorizing a transaction from a different month than whatever page
// happens to be open can't silently link it to the wrong month.
const CATEGORY_PATTERN = /^(none|transfer|expense:[0-9a-f-]{36}|income:[0-9a-f-]{36})$/i;
const categoryField = z.string().regex(CATEGORY_PATTERN).optional();

function decodeCategory(value: string | undefined): CategoryTarget {
  if (!value || value === "none") return { kind: "none" };
  if (value === "transfer") return { kind: "transfer" };
  const [kind, id] = value.split(":");
  return kind === "income" ? { kind: "income", templateId: id } : { kind: "expense", templateId: id };
}

// The target template must belong to this household - otherwise a
// tampered category value could link a transaction to another household's
// budget row.
async function verifyCategoryTarget(householdId: string, target: CategoryTarget) {
  if (target.kind === "expense") {
    const [item] = await db
      .select({ id: lineItemTemplates.id })
      .from(lineItemTemplates)
      .where(
        and(
          eq(lineItemTemplates.id, target.templateId),
          eq(lineItemTemplates.householdId, householdId),
        ),
      )
      .limit(1);
    if (!item) throw new Error("Unknown budget category");
  }
  if (target.kind === "income") {
    const [item] = await db
      .select({ id: incomeTemplates.id })
      .from(incomeTemplates)
      .where(
        and(
          eq(incomeTemplates.id, target.templateId),
          eq(incomeTemplates.householdId, householdId),
        ),
      )
      .limit(1);
    if (!item) throw new Error("Unknown income source");
  }
}

// Resolves a category target into this transaction's own month's instance
// and writes the link - shared by create/update so both categorize a
// transaction from month M against M's instance, never whatever month the
// page happened to be showing.
async function applyCategoryTarget(
  householdId: string,
  transactionId: string,
  postedDate: string,
  target: CategoryTarget,
) {
  if (target.kind === "none" || target.kind === "transfer") {
    await db
      .update(transactions)
      .set({
        budgetLineItemId: null,
        incomeLineItemId: null,
        isTransfer: target.kind === "transfer",
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transactionId));
    return;
  }

  const month = `${postedDate.slice(0, 7)}-01`;
  if (target.kind === "expense") {
    const instanceId = await ensureLineItemInstance(householdId, target.templateId, month);
    await db
      .update(transactions)
      .set({
        budgetLineItemId: instanceId,
        incomeLineItemId: null,
        isTransfer: false,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transactionId));
    return;
  }

  // Income fills SLOTS - even a single manual pick has to go through the
  // same planner the rules engine uses, so it lands on the next open slot
  // for that person/month instead of always slot 1.
  await applyIncomeSlotAssignments(householdId, [
    { txId: transactionId, month, targetTemplateId: target.templateId },
  ]);
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
  const target = decodeCategory(input.category);
  await verifyCategoryTarget(householdId, target);

  const magnitude = Math.abs(dollarsToCents(input.amount));
  const amountCents = input.type === "expense" ? -magnitude : magnitude;

  const createdId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(transactions)
      .values({
        householdId,
        accountId: input.accountId,
        amountCents,
        description: input.description,
        postedDate: input.postedDate,
        note: input.note || null,
        source: "manual",
      })
      .returning({ id: transactions.id });

    await adjustAccountBalance(tx, input.accountId, amountCents);
    return created.id;
  });

  await applyCategoryTarget(householdId, createdId, input.postedDate, target);

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
  const target = decodeCategory(input.category);
  await verifyCategoryTarget(householdId, target);

  const magnitude = Math.abs(dollarsToCents(input.amount));
  const newAmountCents = input.type === "expense" ? -magnitude : magnitude;

  const found = await db.transaction(async (tx) => {
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

    if (!existing) return false;

    // Clear any existing links before re-resolving the category below, so
    // a re-categorized income transaction's own stale link never counts
    // toward slot occupancy for its new target.
    await tx
      .update(transactions)
      .set({
        amountCents: newAmountCents,
        description: input.description,
        postedDate: input.postedDate,
        budgetLineItemId: null,
        incomeLineItemId: null,
        isTransfer: false,
        note: input.note || null,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transactionId));

    const delta = newAmountCents - existing.amountCents;
    await adjustAccountBalance(tx, existing.accountId, delta);
    return true;
  });

  if (!found) return;

  await applyCategoryTarget(householdId, transactionId, input.postedDate, target);

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
// (all pages, not just the visible one) - each transaction resolves its
// OWN month's instance of the target template. Returns the number updated.
export async function bulkCategorizeTransactions(
  rawFilters: TransactionWhereFilters,
  rawCategory: string,
): Promise<number> {
  const householdId = await getCurrentHousehold();
  const filters = bulkFiltersSchema.parse(rawFilters);
  const category = z.string().regex(CATEGORY_PATTERN).parse(rawCategory);
  const target = decodeCategory(category);
  await verifyCategoryTarget(householdId, target);

  const updatedCount = await bulkSetTransactionCategory(householdId, filters, target);

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/budget/income");
  revalidatePath("/accounts");

  return updatedCount;
}

export async function deleteTransaction(transactionId: string) {
  const householdId = await getCurrentHousehold();

  await deleteTransactionById(householdId, transactionId);

  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/budget/income");
  revalidatePath("/accounts");
}
