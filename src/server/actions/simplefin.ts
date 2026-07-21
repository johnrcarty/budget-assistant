"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import {
  simplefinConnections,
  simplefinConnectionAccounts,
  accounts,
  accountKindEnum,
} from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";
import { claimAccessUrl } from "@/server/lib/simplefin/client";
import { encryptSecret } from "@/server/lib/crypto/secret-box";
import { runSimplefinSync } from "@/server/jobs/simplefin-sync";

const LIABILITY_KINDS = new Set(["credit_card", "loan", "line_of_credit"]);

export async function connectSimplefin(formData: FormData) {
  const householdId = await getCurrentHousehold();
  const setupToken = z.string().trim().min(1).parse(formData.get("setupToken"));

  // Single-use: the setup token is claimed exactly once here, and only the
  // resulting Access URL is ever persisted.
  const accessUrl = await claimAccessUrl(setupToken);
  const encrypted = encryptSecret(accessUrl);

  const [connection] = await db
    .insert(simplefinConnections)
    .values({
      householdId,
      accessUrlCiphertext: encrypted.ciphertext,
      accessUrlIv: encrypted.iv,
      accessUrlAuthTag: encrypted.authTag,
      status: "active",
    })
    .returning();

  // Populates simplefin_connection_accounts (unmapped) for the mapping UI
  // and caches balances - reuses the same sync path a scheduled run uses.
  await runSimplefinSync(connection.id);

  revalidatePath("/settings/simplefin");
}

const mapSchema = z
  .object({
    mode: z.enum(["new", "existing"]),
    newAccountName: z.string().trim().max(80).optional(),
    newAccountKind: z.enum(accountKindEnum.enumValues).optional(),
    existingAccountId: z.uuid().optional(),
  })
  .refine((v) => v.mode !== "new" || !!v.newAccountName, {
    message: "Name is required",
  })
  .refine((v) => v.mode !== "existing" || !!v.existingAccountId, {
    message: "Select an account",
  });

export async function mapConnectionAccount(
  connectionAccountId: string,
  formData: FormData,
) {
  const householdId = await getCurrentHousehold();
  const input = mapSchema.parse({
    mode: formData.get("mode"),
    newAccountName: formData.get("newAccountName") || undefined,
    newAccountKind: formData.get("newAccountKind") || undefined,
    existingAccountId: formData.get("existingAccountId") || undefined,
  });

  const [connAccount] = await db
    .select()
    .from(simplefinConnectionAccounts)
    .where(
      and(
        eq(simplefinConnectionAccounts.id, connectionAccountId),
        eq(simplefinConnectionAccounts.householdId, householdId),
      ),
    )
    .limit(1);
  if (!connAccount) return;

  let accountId: string;
  if (input.mode === "new") {
    const kind = input.newAccountKind ?? "checking";
    const [created] = await db
      .insert(accounts)
      .values({
        householdId,
        name: input.newAccountName!,
        kind,
        isLiability: LIABILITY_KINDS.has(kind),
        isManual: false,
        currentBalanceCents: connAccount.lastSyncedBalanceCents ?? 0,
        balanceAsOf: connAccount.lastSyncedAt ?? new Date(),
      })
      .returning();
    accountId = created.id;
  } else {
    accountId = input.existingAccountId!;
    await db
      .update(accounts)
      .set({ isManual: false })
      .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)));
  }

  await db
    .update(simplefinConnectionAccounts)
    .set({ accountId })
    .where(eq(simplefinConnectionAccounts.id, connectionAccountId));

  // Backfill transaction history now that this account has somewhere to go -
  // the sync loop skips transaction import for unmapped accounts.
  await runSimplefinSync(connAccount.connectionId);

  revalidatePath("/settings/simplefin");
  revalidatePath("/accounts");
  revalidatePath("/transactions");
}

export async function triggerSync(connectionId: string) {
  await getCurrentHousehold();
  await runSimplefinSync(connectionId);

  revalidatePath("/settings/simplefin");
  revalidatePath("/accounts");
  revalidatePath("/transactions");
}

export async function disconnectSimplefin(connectionId: string) {
  const householdId = await getCurrentHousehold();

  await db
    .update(simplefinConnections)
    .set({ status: "revoked" })
    .where(
      and(
        eq(simplefinConnections.id, connectionId),
        eq(simplefinConnections.householdId, householdId),
      ),
    );

  revalidatePath("/settings/simplefin");
}
