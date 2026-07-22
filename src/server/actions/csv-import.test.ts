import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { importTransactionsCsv } from "@/server/actions/csv-import";
import { accounts, transactions } from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";
import { getTestDb, type TestDb } from "../../../tests/helpers/pglite";
import { seedAccount, seedHousehold } from "../../../tests/helpers/seed";

vi.mock("@/server/db/client", async () => {
  const { createTestDb } = await import("../../../tests/helpers/pglite");
  return { db: await createTestDb() };
});

// The only Server Action tested directly (per #12): its content-hash dedup
// lives here, not in the query layer. The two request-context dependencies
// are mocked; everything below them (zod, db.transaction, upsert,
// adjustAccountBalance, rules) runs for real against PGlite.
vi.mock("@/server/lib/dal", () => ({
  getCurrentHousehold: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockHousehold = vi.mocked(getCurrentHousehold);
const mockRevalidate = vi.mocked(revalidatePath);

let db: TestDb;
beforeAll(() => {
  db = getTestDb();
});

beforeEach(() => {
  mockRevalidate.mockClear();
});

async function seedImportTarget() {
  const household = await seedHousehold(db);
  const account = await seedAccount(db, household.id, { currentBalanceCents: 0 });
  mockHousehold.mockResolvedValue(household.id);
  return { household, account };
}

const ROWS = [
  { postedDate: "2026-07-01", description: "COFFEE SHOP", amountCents: -450 },
  { postedDate: "2026-07-02", description: "GROCERY STORE", amountCents: -8231 },
  { postedDate: "2026-07-03", description: "PAYCHECK", amountCents: 250000 },
];

const accountBalance = async (accountId: string) => {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  return account.currentBalanceCents;
};

const accountRows = (accountId: string) =>
  db.select().from(transactions).where(eq(transactions.accountId, accountId));

describe("importTransactionsCsv dedup", () => {
  it("imports fresh rows with content-hash external ids", async () => {
    const { account } = await seedImportTarget();

    const result = await importTransactionsCsv(account.id, ROWS);
    expect(result).toEqual({ imported: 3, skippedDuplicates: 0 });

    const rows = await accountRows(account.id);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.source).toBe("csv_import");
      expect(row.externalId).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    }
    expect(await accountBalance(account.id)).toBe(-450 - 8231 + 250000);
  });

  it("re-importing the same file imports nothing and leaves the balance alone", async () => {
    const { account } = await seedImportTarget();
    await importTransactionsCsv(account.id, ROWS);

    const result = await importTransactionsCsv(account.id, ROWS);
    expect(result).toEqual({ imported: 0, skippedDuplicates: 3 });
    expect(await accountRows(account.id)).toHaveLength(3);
    expect(await accountBalance(account.id)).toBe(-450 - 8231 + 250000);
  });

  it("a mixed batch imports only the new rows and adjusts the balance by them alone", async () => {
    const { account } = await seedImportTarget();
    await importTransactionsCsv(account.id, ROWS.slice(0, 2));

    const newRows = [
      { postedDate: "2026-07-04", description: "GAS STATION", amountCents: -3000 },
      { postedDate: "2026-07-05", description: "RESTAURANT", amountCents: -5600 },
      { postedDate: "2026-07-06", description: "REFUND", amountCents: 1200 },
    ];
    const result = await importTransactionsCsv(account.id, [...ROWS.slice(0, 2), ...newRows]);
    expect(result).toEqual({ imported: 3, skippedDuplicates: 2 });
    expect(await accountRows(account.id)).toHaveLength(5);
    expect(await accountBalance(account.id)).toBe(-450 - 8231 - 3000 - 5600 + 1200);
  });

  it("skips an intra-batch duplicate (content-hash limitation, documented in the action)", async () => {
    const { account } = await seedImportTarget();

    // Two genuinely different transactions sharing date+description+amount
    // collide by design - that's the price of content-based dedup.
    const twin = { postedDate: "2026-07-01", description: "COFFEE SHOP", amountCents: -450 };
    const result = await importTransactionsCsv(account.id, [twin, twin]);
    expect(result).toEqual({ imported: 1, skippedDuplicates: 1 });
  });

  it("dedup is scoped per account - the same content imports on another account", async () => {
    const { household, account } = await seedImportTarget();
    const other = await seedAccount(db, household.id, {
      name: "Other Checking",
      currentBalanceCents: 0,
    });
    await importTransactionsCsv(account.id, ROWS);

    const result = await importTransactionsCsv(other.id, ROWS);
    expect(result).toEqual({ imported: 3, skippedDuplicates: 0 });
  });
});

describe("importTransactionsCsv guards", () => {
  it("rejects an account belonging to another household", async () => {
    const { account } = await seedImportTarget();
    const stranger = await seedHousehold(db, "Other Household");
    mockHousehold.mockResolvedValue(stranger.id);

    await expect(importTransactionsCsv(account.id, ROWS)).rejects.toThrow("Account not found");
    expect(await accountRows(account.id)).toHaveLength(0);
  });

  it("rejects invalid rows via zod (catches parseDateToIso's unvalidated output)", async () => {
    const { account } = await seedImportTarget();

    await expect(
      importTransactionsCsv(account.id, [
        { postedDate: "2026-13-45", description: "BAD DATE", amountCents: -100 },
      ]),
    ).rejects.toThrow();
    await expect(importTransactionsCsv(account.id, [])).rejects.toThrow();
  });

  it("revalidates the affected pages after a successful import", async () => {
    const { account } = await seedImportTarget();
    await importTransactionsCsv(account.id, ROWS);

    const paths = mockRevalidate.mock.calls.map(([path]) => path);
    expect(paths).toEqual(["/transactions", "/budget", "/accounts"]);
  });
});
