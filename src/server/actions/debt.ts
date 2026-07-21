"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import {
  accounts,
  budgetLineItems,
  debtBalanceSnapshots,
  debtTermsVersions,
  lineItemTemplates,
} from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";
import { dollarsToCents } from "@/server/lib/money";
import { getBudgetMonth } from "@/server/db/queries/budget";
import { currentMonthString } from "@/lib/month";

const infoSchema = z.object({
  name: z.string().trim().min(1).max(80),
  subtype: z.string().trim().max(80).optional(),
  originalBalance: z.string().trim().optional(),
});

export async function updateDebtAccountInfo(accountId: string, formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = infoSchema.parse({
    name: formData.get("name"),
    subtype: formData.get("subtype") || undefined,
    originalBalance: formData.get("originalBalance") || undefined,
  });

  await db
    .update(accounts)
    .set({
      name: input.name,
      subtype: input.subtype || null,
      originalBalanceCents: input.originalBalance ? dollarsToCents(input.originalBalance) : null,
    })
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.householdId, householdId),
        eq(accounts.isLiability, true),
      ),
    );

  // Keep a linked budget item's name in sync with the account name (the
  // item exists to represent this debt, so a rename should follow it).
  const [template] = await db
    .select()
    .from(lineItemTemplates)
    .where(
      and(
        eq(lineItemTemplates.debtAccountId, accountId),
        eq(lineItemTemplates.householdId, householdId),
      ),
    )
    .limit(1);
  if (template) {
    await db
      .update(lineItemTemplates)
      .set({ name: input.name })
      .where(eq(lineItemTemplates.id, template.id));
    const budgetMonth = await getBudgetMonth(householdId, currentMonthString());
    if (budgetMonth) {
      await db
        .update(budgetLineItems)
        .set({ name: input.name, updatedAt: new Date() })
        .where(
          and(
            eq(budgetLineItems.budgetMonthId, budgetMonth.id),
            eq(budgetLineItems.templateItemId, template.id),
          ),
        );
    }
    revalidatePath("/budget");
  }

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
}

// Manual balance update - always appends a new snapshot (today, by default),
// never edits history. Re-running for the same day updates that day's row
// via the unique (accountId, asOfDate, source) constraint rather than
// creating a second entry for the same date.
const balanceSchema = z.object({
  balance: z.string().trim().min(1),
  asOfDate: z.string(),
  note: z.string().trim().max(2000).optional(),
});

export async function addBalanceSnapshot(accountId: string, formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = balanceSchema.parse({
    balance: formData.get("balance"),
    asOfDate: formData.get("asOfDate"),
    note: formData.get("note") || undefined,
  });

  const [account] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.householdId, householdId),
        eq(accounts.isLiability, true),
      ),
    )
    .limit(1);
  if (!account) return;

  const balanceCents = Math.abs(dollarsToCents(input.balance));

  await db
    .insert(debtBalanceSnapshots)
    .values({
      accountId,
      asOfDate: input.asOfDate,
      balanceCents,
      source: "manual",
      note: input.note || null,
    })
    .onConflictDoUpdate({
      target: [debtBalanceSnapshots.accountId, debtBalanceSnapshots.asOfDate, debtBalanceSnapshots.source],
      set: { balanceCents, note: input.note || null },
    });

  // Keep the cached "current" balance in sync when this is the newest
  // known snapshot - an older backfilled date shouldn't overwrite a newer one.
  if (!account.balanceAsOf || new Date(input.asOfDate) >= account.balanceAsOf) {
    await db
      .update(accounts)
      .set({ currentBalanceCents: balanceCents, balanceAsOf: new Date(input.asOfDate) })
      .where(eq(accounts.id, accountId));
  }

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
}

// Terms only ever get a new version row appended - never edited in place -
// so old terms stay on the record for whatever date range they applied to.
const termsSchema = z.object({
  termsType: z.enum(["revolving", "installment"]),
  effectiveDate: z.string(),
  apr: z.string().trim().optional(),
  paymentFrequency: z.enum(["monthly", "semimonthly", "biweekly", "weekly"]),
  minPayment: z.string().trim().optional(),
  // Not z.coerce.boolean() - Boolean("false") is true in JS.
  minPaymentIsPercent: z.enum(["true", "false"]).optional(),
  minPaymentPercent: z.string().trim().optional(),
  fixedPayment: z.string().trim().optional(),
  payoffTargetDate: z.string().trim().optional(),
  dueDay: z.coerce.number().int().min(1).max(31).optional().or(z.literal("")),
  servicerName: z.string().trim().max(80).optional(),
  note: z.string().trim().max(2000).optional(),
});

export async function addDebtTermsVersion(accountId: string, formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = termsSchema.parse({
    termsType: formData.get("termsType"),
    effectiveDate: formData.get("effectiveDate"),
    apr: formData.get("apr") || undefined,
    paymentFrequency: formData.get("paymentFrequency") || "monthly",
    minPayment: formData.get("minPayment") || undefined,
    minPaymentIsPercent: formData.get("minPaymentIsPercent") || undefined,
    minPaymentPercent: formData.get("minPaymentPercent") || undefined,
    fixedPayment: formData.get("fixedPayment") || undefined,
    payoffTargetDate: formData.get("payoffTargetDate") || undefined,
    dueDay: formData.get("dueDay") || "",
    servicerName: formData.get("servicerName") || undefined,
    note: formData.get("note") || undefined,
  });

  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.householdId, householdId),
        eq(accounts.isLiability, true),
      ),
    )
    .limit(1);
  if (!account) return;

  const minPaymentIsPercent = input.minPaymentIsPercent === "true";

  await db.insert(debtTermsVersions).values({
    accountId,
    effectiveDate: input.effectiveDate,
    termsType: input.termsType,
    aprBps: input.apr ? Math.round(Number(input.apr) * 100) : null,
    paymentFrequency: input.paymentFrequency,
    minPaymentCents: input.minPayment ? dollarsToCents(input.minPayment) : null,
    minPaymentIsPercent,
    minPaymentPercentBps:
      minPaymentIsPercent && input.minPaymentPercent
        ? Math.round(Number(input.minPaymentPercent) * 100)
        : null,
    fixedPaymentCents: input.fixedPayment ? dollarsToCents(input.fixedPayment) : null,
    payoffTargetDate: input.payoffTargetDate || null,
    // A biweekly/weekly debt has no day-of-month due day.
    dueDay:
      input.paymentFrequency !== "monthly" || input.dueDay === "" ? null : input.dueDay,
    servicerName: input.servicerName || null,
    note: input.note || null,
  });

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/debt");
}
