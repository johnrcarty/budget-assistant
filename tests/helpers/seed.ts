import {
  accounts,
  debtBalanceSnapshots,
  debtTermsVersions,
  households,
  simplefinConnectionAccounts,
  simplefinConnections,
} from "@/server/db/schema";
import { encryptSecret } from "@/server/lib/crypto/secret-box";

import type { TestDb } from "./pglite";

export async function seedHousehold(db: TestDb, name = "Test Household") {
  const [household] = await db.insert(households).values({ name }).returning();
  return household;
}

export async function seedAccount(
  db: TestDb,
  householdId: string,
  overrides: Partial<typeof accounts.$inferInsert> = {},
) {
  const [account] = await db
    .insert(accounts)
    .values({
      householdId,
      name: "Test Account",
      kind: "checking",
      ...overrides,
    })
    .returning();
  return account;
}

export function seedLiabilityAccount(
  db: TestDb,
  householdId: string,
  overrides: Partial<typeof accounts.$inferInsert> = {},
) {
  return seedAccount(db, householdId, {
    name: "Test Debt",
    kind: "credit_card",
    isLiability: true,
    ...overrides,
  });
}

// Tie-break tests (same effectiveDate/asOfDate resolved by createdAt DESC)
// must pass explicit distinct createdAt values - defaultNow() on back-to-back
// inserts can collide, making the ordering nondeterministic.
export async function seedDebtTerms(
  db: TestDb,
  accountId: string,
  overrides: Partial<typeof debtTermsVersions.$inferInsert> = {},
) {
  const [terms] = await db
    .insert(debtTermsVersions)
    .values({
      accountId,
      effectiveDate: "2025-01-01",
      termsType: "revolving",
      ...overrides,
    })
    .returning();
  return terms;
}

// Encrypts a fake Access URL with the real secret-box (the throwaway
// SIMPLEFIN_ENCRYPTION_KEY from tests/setup.ts), so the sync job's decrypt
// path runs for real.
export async function seedSimplefinConnection(
  db: TestDb,
  householdId: string,
  overrides: Partial<typeof simplefinConnections.$inferInsert> = {},
) {
  const encrypted = encryptSecret("https://user:pass@bridge.example.com/simplefin");
  const [connection] = await db
    .insert(simplefinConnections)
    .values({
      householdId,
      accessUrlCiphertext: encrypted.ciphertext,
      accessUrlIv: encrypted.iv,
      accessUrlAuthTag: encrypted.authTag,
      ...overrides,
    })
    .returning();
  return connection;
}

export async function seedConnectionAccount(
  db: TestDb,
  connection: { id: string; householdId: string },
  simplefinAccountId: string,
  overrides: Partial<typeof simplefinConnectionAccounts.$inferInsert> = {},
) {
  const [connAccount] = await db
    .insert(simplefinConnectionAccounts)
    .values({
      connectionId: connection.id,
      householdId: connection.householdId,
      simplefinAccountId,
      ...overrides,
    })
    .returning();
  return connAccount;
}

export async function seedDebtSnapshot(
  db: TestDb,
  accountId: string,
  overrides: Partial<typeof debtBalanceSnapshots.$inferInsert> = {},
) {
  const [snapshot] = await db
    .insert(debtBalanceSnapshots)
    .values({
      accountId,
      asOfDate: "2025-01-01",
      balanceCents: 100000,
      ...overrides,
    })
    .returning();
  return snapshot;
}
