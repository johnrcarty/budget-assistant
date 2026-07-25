import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { addBalanceSnapshot } from "@/server/actions/debt";
import { addAssetValueSnapshot } from "@/server/actions/accounts";
import { accounts, debtBalanceSnapshots } from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";
import { getTestDb, type TestDb } from "../../../tests/helpers/pglite";
import { seedAccount, seedHousehold, seedLiabilityAccount } from "../../../tests/helpers/seed";

vi.mock("@/server/db/client", async () => {
  const { createTestDb } = await import("../../../tests/helpers/pglite");
  return { db: await createTestDb() };
});

vi.mock("@/server/lib/dal", () => ({
  getCurrentHousehold: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockHousehold = vi.mocked(getCurrentHousehold);

let db: TestDb;
beforeAll(() => {
  db = getTestDb();
});

const balanceForm = (balance: string, asOfDate: string) => {
  const formData = new FormData();
  formData.set("balance", balance);
  formData.set("asOfDate", asOfDate);
  return formData;
};

const cachedBalance = async (accountId: string) => {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  return account.currentBalanceCents;
};

// Regression tests for the cached-balance refresh guard: balanceAsOf can be
// a full timestamp (account creation, SimpleFin sync) while the form's
// asOfDate is a date-only string, so the old `new Date(asOfDate) >=
// balanceAsOf` comparison (midnight UTC vs time-of-day) silently skipped
// same-day updates - snapshot row written, cached list balance stale.
describe("addBalanceSnapshot cached-balance refresh", () => {
  it("refreshes the cache when updating the same day the account was created", async () => {
    const household = await seedHousehold(db);
    mockHousehold.mockResolvedValue(household.id);
    // Created "tonight" at 10:02pm Central = next day 03:02 UTC - both the
    // time-of-day and the UTC calendar-day skew that hid the update.
    const account = await seedLiabilityAccount(db, household.id, {
      currentBalanceCents: 96534,
      balanceAsOf: new Date("2026-07-25T03:02:00Z"),
    });

    await addBalanceSnapshot(account.id, balanceForm("202.41", "2026-07-24"));

    expect(await cachedBalance(account.id)).toBe(20241);
  });

  it("still ignores a genuinely backfilled older date", async () => {
    const household = await seedHousehold(db);
    mockHousehold.mockResolvedValue(household.id);
    const account = await seedLiabilityAccount(db, household.id, {
      currentBalanceCents: 96534,
      balanceAsOf: new Date("2026-07-25T03:02:00Z"),
    });

    await addBalanceSnapshot(account.id, balanceForm("500.00", "2026-06-01"));

    // History gets the row, the cache keeps the newer value.
    const rows = await db
      .select()
      .from(debtBalanceSnapshots)
      .where(eq(debtBalanceSnapshots.accountId, account.id));
    expect(rows).toHaveLength(1);
    expect(await cachedBalance(account.id)).toBe(96534);
  });

  it("re-saving the same date updates that day's row and the cache", async () => {
    const household = await seedHousehold(db);
    mockHousehold.mockResolvedValue(household.id);
    const account = await seedLiabilityAccount(db, household.id, {
      currentBalanceCents: 96534,
      balanceAsOf: new Date("2026-07-25T03:02:00Z"),
    });

    await addBalanceSnapshot(account.id, balanceForm("300.00", "2026-07-24"));
    await addBalanceSnapshot(account.id, balanceForm("202.41", "2026-07-24"));

    const rows = await db
      .select()
      .from(debtBalanceSnapshots)
      .where(eq(debtBalanceSnapshots.accountId, account.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].balanceCents).toBe(20241);
    expect(await cachedBalance(account.id)).toBe(20241);
  });
});

describe("addAssetValueSnapshot cached-balance refresh", () => {
  it("refreshes the cache when updating the same day the asset was created", async () => {
    const household = await seedHousehold(db);
    mockHousehold.mockResolvedValue(household.id);
    const account = await seedAccount(db, household.id, {
      kind: "property",
      isManual: true,
      currentBalanceCents: 24500000,
      balanceAsOf: new Date("2026-07-25T03:02:00Z"),
    });

    const formData = new FormData();
    formData.set("value", "250000.00");
    formData.set("asOfDate", "2026-07-24");
    await addAssetValueSnapshot(account.id, formData);

    expect(await cachedBalance(account.id)).toBe(25000000);
  });
});
