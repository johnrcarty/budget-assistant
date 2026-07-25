import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { deleteTransactionById } from "@/server/db/queries/transactions";
import { accounts, transactions, transactionExclusions } from "@/server/db/schema";
import { getTestDb, type TestDb } from "../../../../tests/helpers/pglite";
import { seedAccount, seedHousehold } from "../../../../tests/helpers/seed";

vi.mock("@/server/db/client", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/pglite");
  return { db: await createTestDb() };
});

let db: TestDb;
beforeAll(() => {
  db = getTestDb();
});

async function seedDeleteTarget() {
  const household = await seedHousehold(db);
  const account = await seedAccount(db, household.id, { currentBalanceCents: 10000 });
  return { household, account };
}

const accountBalance = async (accountId: string) => {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  return account.currentBalanceCents;
};

const exclusionsFor = (accountId: string) =>
  db
    .select()
    .from(transactionExclusions)
    .where(eq(transactionExclusions.accountId, accountId));

describe("deleteTransactionById", () => {
  it("deleting a manual transaction adjusts the balance and records no exclusion", async () => {
    const { household, account } = await seedDeleteTarget();
    const [manual] = await db
      .insert(transactions)
      .values({
        householdId: household.id,
        accountId: account.id,
        amountCents: -2500,
        description: "MANUAL ENTRY",
        postedDate: "2026-07-20",
      })
      .returning();

    expect(await deleteTransactionById(household.id, manual.id)).toBe(true);

    expect(
      await db.select().from(transactions).where(eq(transactions.id, manual.id)),
    ).toHaveLength(0);
    // Manual rows have no feed identity - nothing can re-import them, so no
    // tombstone should accumulate.
    expect(await exclusionsFor(account.id)).toHaveLength(0);
    expect(await accountBalance(account.id)).toBe(12500);
  });

  it("deleting a synced transaction records an exclusion tombstone", async () => {
    const { household, account } = await seedDeleteTarget();
    const [synced] = await db
      .insert(transactions)
      .values({
        householdId: household.id,
        accountId: account.id,
        amountCents: -266952,
        description: "DIRECT DEPOSIT PROGRESSIVE PAYROLL (Cash)",
        postedDate: "2026-07-22",
        source: "simplefin",
        externalId: "TRN-phantom",
      })
      .returning();

    expect(await deleteTransactionById(household.id, synced.id)).toBe(true);

    const exclusions = await exclusionsFor(account.id);
    expect(exclusions).toHaveLength(1);
    expect(exclusions[0]).toMatchObject({
      householdId: household.id,
      source: "simplefin",
      externalId: "TRN-phantom",
      description: "DIRECT DEPOSIT PROGRESSIVE PAYROLL (Cash)",
      amountCents: -266952,
      postedDate: "2026-07-22",
    });
    expect(await accountBalance(account.id)).toBe(10000 + 266952);
  });

  it("never deletes across households", async () => {
    const { household, account } = await seedDeleteTarget();
    const stranger = await seedHousehold(db, "Other Household");
    const [row] = await db
      .insert(transactions)
      .values({
        householdId: household.id,
        accountId: account.id,
        amountCents: -100,
        description: "NOT YOURS",
        postedDate: "2026-07-20",
        source: "simplefin",
        externalId: "t-guard",
      })
      .returning();

    expect(await deleteTransactionById(stranger.id, row.id)).toBe(false);
    expect(await db.select().from(transactions).where(eq(transactions.id, row.id))).toHaveLength(1);
    expect(await exclusionsFor(account.id)).toHaveLength(0);
  });
});
