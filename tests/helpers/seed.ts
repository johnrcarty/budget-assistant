import {
  accounts,
  debtBalanceSnapshots,
  debtTermsVersions,
  households,
} from "@/server/db/schema";

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
