"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import {
  accounts,
  accountGroups,
  accountKindEnum,
  lineItemTemplates,
  accountBalanceSnapshots,
  accountOwners,
} from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";
import { getValidPersonIds } from "@/server/db/queries/people";
import { dollarsToCents } from "@/server/lib/money";

const LIABILITY_KINDS = new Set(["credit_card", "loan", "line_of_credit"]);
// Physical assets: valued manually, never synced, and the only kinds whose
// balance history is exclusively manual snapshots.
const PHYSICAL_ASSET_KINDS = new Set(["property", "vehicle"]);

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(accountKindEnum.enumValues),
  startingBalance: z.string().trim(),
  purchasePrice: z.string().trim().optional(),
  purchaseDate: z.string().regex(ISO_DATE_PATTERN).optional(),
  // "none", "__new__" (with newGroupName), or a group uuid.
  accountGroupId: z.string().optional(),
  newGroupName: z.string().trim().max(80).optional(),
  // 0 = unassigned/shared, 1 = individual, 2+ = joint.
  ownerPersonIds: z.array(z.string()).default([]),
});

// Replaces one account's owner rows wholesale with personIds (already
// household-validated).
async function writeAccountOwners(accountId: string, personIds: string[]) {
  await db.delete(accountOwners).where(eq(accountOwners.accountId, accountId));
  if (personIds.length > 0) {
    await db
      .insert(accountOwners)
      .values(personIds.map((personId) => ({ accountId, personId })))
      .onConflictDoNothing();
  }
}

async function syncAccountOwners(
  householdId: string,
  accountId: string,
  ownerPersonIds: string[],
) {
  const validIds = await getValidPersonIds(householdId, ownerPersonIds);
  await writeAccountOwners(accountId, validIds);
}

// Cascades an owner selection from a group down to every member account -
// e.g. setting "Person A" once on the "Student Loans" group instead of
// editing each loan individually. Overwrites each member's existing owners
// wholesale, same as editing them one at a time.
export async function setAccountGroupOwners(groupId: string, formData: FormData) {
  const householdId = await getCurrentHousehold();
  const validIds = await getValidPersonIds(
    householdId,
    formData.getAll("ownerPersonIds").map(String),
  );

  const members = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.accountGroupId, groupId), eq(accounts.householdId, householdId)));

  for (const member of members) {
    await writeAccountOwners(member.id, validIds);
  }

  revalidatePath("/accounts");
}

// Resolves the Group select's value to a group id or null. "__new__" is
// get-or-create by (household, name) - the unique constraint makes the
// conflict path race-safe. A uuid is only honored if it belongs to this
// household. Non-exported, so it never becomes a server-action endpoint.
async function resolveAccountGroupId(
  householdId: string,
  accountGroupId: string | undefined,
  newGroupName: string | undefined,
): Promise<string | null> {
  if (accountGroupId === "__new__" && newGroupName) {
    const [created] = await db
      .insert(accountGroups)
      .values({ householdId, name: newGroupName })
      .onConflictDoNothing()
      .returning({ id: accountGroups.id });
    if (created) return created.id;
    const [existing] = await db
      .select({ id: accountGroups.id })
      .from(accountGroups)
      .where(
        and(eq(accountGroups.householdId, householdId), eq(accountGroups.name, newGroupName)),
      )
      .limit(1);
    return existing?.id ?? null;
  }
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (accountGroupId && UUID_PATTERN.test(accountGroupId)) {
    const [group] = await db
      .select({ id: accountGroups.id })
      .from(accountGroups)
      .where(
        and(eq(accountGroups.id, accountGroupId), eq(accountGroups.householdId, householdId)),
      )
      .limit(1);
    return group?.id ?? null;
  }
  return null;
}

export async function createAccount(formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = createSchema.parse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    startingBalance: formData.get("startingBalance") || "0",
    purchasePrice: formData.get("purchasePrice") || undefined,
    purchaseDate: formData.get("purchaseDate") || undefined,
    accountGroupId: formData.get("accountGroupId") || undefined,
    newGroupName: formData.get("newGroupName") || undefined,
    ownerPersonIds: formData.getAll("ownerPersonIds"),
  });

  const isPhysicalAsset = PHYSICAL_ASSET_KINDS.has(input.kind);
  const balanceCents = dollarsToCents(input.startingBalance);
  const purchasePriceCents = input.purchasePrice
    ? Math.abs(dollarsToCents(input.purchasePrice))
    : null;
  const accountGroupId = await resolveAccountGroupId(
    householdId,
    input.accountGroupId,
    input.newGroupName,
  );

  const [created] = await db
    .insert(accounts)
    .values({
      householdId,
      name: input.name,
      kind: input.kind,
      isLiability: LIABILITY_KINDS.has(input.kind),
      currentBalanceCents: balanceCents,
      balanceAsOf: new Date(),
      accountGroupId,
      // For physical assets this means "purchase price" - the same
      // fixed-reference-point role it plays for debts ("balance when this
      // debt started").
      originalBalanceCents: isPhysicalAsset ? purchasePriceCents : null,
    })
    .returning();

  await syncAccountOwners(householdId, created.id, input.ownerPersonIds);

  // Physical assets have no transactions and no sync, so manual snapshots
  // are their only trend history - seed it at creation: current value
  // today, plus the purchase point if given, so the trend line starts at
  // the purchase and shows appreciation since.
  if (isPhysicalAsset) {
    const today = todayIso();
    await db
      .insert(accountBalanceSnapshots)
      .values({
        accountId: created.id,
        asOfDate: today,
        balanceCents: Math.abs(balanceCents),
        source: "manual",
      })
      .onConflictDoNothing();
    if (purchasePriceCents !== null && input.purchaseDate && input.purchaseDate < today) {
      await db
        .insert(accountBalanceSnapshots)
        .values({
          accountId: created.id,
          asOfDate: input.purchaseDate,
          balanceCents: purchasePriceCents,
          source: "manual",
        })
        .onConflictDoNothing();
    }
  }

  revalidatePath("/accounts");
  revalidatePath("/transactions");
}

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(accountKindEnum.enumValues),
  accountGroupId: z.string().optional(),
  newGroupName: z.string().trim().max(80).optional(),
  ownerPersonIds: z.array(z.string()).default([]),
});

// Edits name/kind. isLiability follows the kind - fixing a 401k that was
// created as "checking" to "investment" is the motivating case.
export async function updateAccount(accountId: string, formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = updateSchema.parse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    accountGroupId: formData.get("accountGroupId") || undefined,
    newGroupName: formData.get("newGroupName") || undefined,
    ownerPersonIds: formData.getAll("ownerPersonIds"),
  });
  const isLiability = LIABILITY_KINDS.has(input.kind);
  const accountGroupId = await resolveAccountGroupId(
    householdId,
    input.accountGroupId,
    input.newGroupName,
  );

  await db
    .update(accounts)
    .set({
      name: input.name,
      kind: input.kind,
      isLiability,
      accountGroupId,
      // A non-liability can't be secured by anything - clear the outbound
      // link when a debt becomes an asset.
      ...(isLiability ? {} : { securedAssetAccountId: null }),
    })
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)));

  await syncAccountOwners(householdId, accountId, input.ownerPersonIds);

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

  // If an asset became a liability, loans secured by it now point at
  // another debt - sever those inbound links so equity math never counts
  // a liability as collateral.
  if (isLiability) {
    await db
      .update(accounts)
      .set({ securedAssetAccountId: null })
      .where(
        and(
          eq(accounts.securedAssetAccountId, accountId),
          eq(accounts.householdId, householdId),
        ),
      );
  }

  revalidatePath("/accounts");
  revalidatePath("/debt");
  revalidatePath("/transactions");
}

const assetValueSchema = z.object({
  value: z.string().trim().min(1),
  asOfDate: z.string().regex(ISO_DATE_PATTERN),
});

// Manual asset-value update with history: the asset analog of
// addBalanceSnapshot in actions/debt.ts. Writes an account_balance_snapshot
// row (source "manual") so the trend line moves, and refreshes the cached
// balance only when the new date is the newest known.
export async function addAssetValueSnapshot(accountId: string, formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = assetValueSchema.parse({
    value: formData.get("value"),
    asOfDate: formData.get("asOfDate"),
  });

  const [account] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.householdId, householdId),
        eq(accounts.isLiability, false),
        eq(accounts.isManual, true),
      ),
    )
    .limit(1);
  if (!account) return;

  const balanceCents = Math.abs(dollarsToCents(input.value));

  await db
    .insert(accountBalanceSnapshots)
    .values({ accountId, asOfDate: input.asOfDate, balanceCents, source: "manual" })
    .onConflictDoUpdate({
      target: [
        accountBalanceSnapshots.accountId,
        accountBalanceSnapshots.asOfDate,
        accountBalanceSnapshots.source,
      ],
      set: { balanceCents },
    });

  if (!account.balanceAsOf || new Date(input.asOfDate) >= account.balanceAsOf) {
    await db
      .update(accounts)
      .set({ currentBalanceCents: balanceCents, balanceAsOf: new Date(input.asOfDate) })
      .where(eq(accounts.id, accountId));
  }

  revalidatePath("/accounts");
}

const purchasePriceSchema = z.object({
  purchasePrice: z.string().trim().min(1),
});

// Backfill path for assets created before purchase price existed (or when
// the price was simply skipped at creation).
export async function setAssetPurchasePrice(accountId: string, formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = purchasePriceSchema.parse({
    purchasePrice: formData.get("purchasePrice"),
  });

  await db
    .update(accounts)
    .set({ originalBalanceCents: Math.abs(dollarsToCents(input.purchasePrice)) })
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.householdId, householdId),
        eq(accounts.isLiability, false),
      ),
    );

  revalidatePath("/accounts");
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
