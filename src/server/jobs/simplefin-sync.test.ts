import { and, eq, ne } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runSimplefinSync } from "@/server/jobs/simplefin-sync";
import {
  accountBalanceSnapshots,
  accounts,
  debtBalanceSnapshots,
  simplefinConnectionAccounts,
  simplefinConnections,
  syncRuns,
  transactions,
} from "@/server/db/schema";
import { getSimplefinAccounts } from "@/server/lib/simplefin/client";
import { getTestDb, type TestDb } from "../../../tests/helpers/pglite";
import {
  seedAccount,
  seedConnectionAccount,
  seedHousehold,
  seedLiabilityAccount,
  seedSimplefinConnection,
} from "../../../tests/helpers/seed";
import {
  epochSeconds,
  sfAccount,
  sfResponse,
  sfTransaction,
} from "../../../tests/helpers/simplefin-fixtures";

vi.mock("@/server/db/client", async () => {
  const { createTestDb } = await import("../../../tests/helpers/pglite");
  return { db: await createTestDb() };
});

vi.mock("@/server/lib/simplefin/client", () => ({
  claimAccessUrl: vi.fn(),
  getSimplefinAccounts: vi.fn(),
}));

const mockGetAccounts = vi.mocked(getSimplefinAccounts);

let db: TestDb;
beforeAll(() => {
  db = getTestDb();
});

beforeEach(() => {
  mockGetAccounts.mockReset();
});

// One household + connection + mapped local account, ready to sync.
async function seedSyncSetup(opts: { isLiability?: boolean } = {}) {
  const household = await seedHousehold(db);
  const account = opts.isLiability
    ? await seedLiabilityAccount(db, household.id)
    : await seedAccount(db, household.id);
  const connection = await seedSimplefinConnection(db, household.id);
  await seedConnectionAccount(db, connection, "sf-1", { accountId: account.id });
  return { household, account, connection };
}

const countTransactions = async (accountId: string) =>
  (await db.select().from(transactions).where(eq(transactions.accountId, accountId))).length;

const latestSyncRun = async (connectionId: string) => {
  const runs = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.connectionId, connectionId));
  return runs[runs.length - 1];
};

const getConnection = async (connectionId: string) => {
  const [row] = await db
    .select()
    .from(simplefinConnections)
    .where(eq(simplefinConnections.id, connectionId));
  return row;
};

describe("sync idempotency", () => {
  it("re-syncing identical data duplicates nothing", async () => {
    const { account, connection } = await seedSyncSetup({ isLiability: true });
    const fixture = () =>
      sfResponse([
        sfAccount({
          id: "sf-1",
          balance: "-543.21",
          transactions: [
            sfTransaction({ id: "t-1", amount: "-12.34", posted: epochSeconds("2026-07-08") }),
            sfTransaction({ id: "t-2", amount: "-45.00", posted: epochSeconds("2026-07-09") }),
            sfTransaction({ id: "t-3", amount: "1500.00", posted: epochSeconds("2026-07-10") }),
          ],
        }),
      ]);

    mockGetAccounts.mockResolvedValue(fixture());
    await runSimplefinSync(connection.id);
    mockGetAccounts.mockResolvedValue(fixture());
    await runSimplefinSync(connection.id);

    expect(await countTransactions(account.id)).toBe(3);

    const debtSnapshots = await db
      .select()
      .from(debtBalanceSnapshots)
      .where(eq(debtBalanceSnapshots.accountId, account.id));
    expect(debtSnapshots).toHaveLength(1);

    const balanceSnapshots = await db
      .select()
      .from(accountBalanceSnapshots)
      .where(eq(accountBalanceSnapshots.accountId, account.id));
    expect(balanceSnapshots).toHaveLength(1);

    // Both runs recorded, both clean.
    const runs = await db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.connectionId, connection.id));
    expect(runs.map((r) => r.status)).toEqual(["success", "success"]);
  });

  it("re-syncing an amended transaction updates it in place", async () => {
    const { account, connection } = await seedSyncSetup();

    mockGetAccounts.mockResolvedValue(
      sfResponse([
        sfAccount({
          id: "sf-1",
          transactions: [sfTransaction({ id: "t-1", amount: "-10.00", pending: true })],
        }),
      ]),
    );
    await runSimplefinSync(connection.id);

    // Same external id, now posted with a corrected amount.
    mockGetAccounts.mockResolvedValue(
      sfResponse([
        sfAccount({
          id: "sf-1",
          transactions: [sfTransaction({ id: "t-1", amount: "-10.50", pending: false })],
        }),
      ]),
    );
    await runSimplefinSync(connection.id);

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, account.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(-1050);
    expect(rows[0].pending).toBe(false);
  });

  it("a changed balance on the same balance-date updates the snapshot, not duplicates it", async () => {
    const { account, connection } = await seedSyncSetup({ isLiability: true });
    const balanceDate = epochSeconds("2026-07-10");

    mockGetAccounts.mockResolvedValue(
      sfResponse([sfAccount({ id: "sf-1", balance: "-500.00", "balance-date": balanceDate })]),
    );
    await runSimplefinSync(connection.id);

    mockGetAccounts.mockResolvedValue(
      sfResponse([sfAccount({ id: "sf-1", balance: "-490.00", "balance-date": balanceDate })]),
    );
    await runSimplefinSync(connection.id);

    const snapshots = await db
      .select()
      .from(debtBalanceSnapshots)
      .where(eq(debtBalanceSnapshots.accountId, account.id));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].balanceCents).toBe(49000);
  });
});

describe("liability balance normalization", () => {
  it("stores SimpleFin's negative liability balance as positive amount owed", async () => {
    const { account, connection } = await seedSyncSetup({ isLiability: true });

    mockGetAccounts.mockResolvedValue(
      sfResponse([sfAccount({ id: "sf-1", balance: "-543.21" })]),
    );
    await runSimplefinSync(connection.id);

    const [updated] = await db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(updated.currentBalanceCents).toBe(54321);

    const [snapshot] = await db
      .select()
      .from(debtBalanceSnapshots)
      .where(eq(debtBalanceSnapshots.accountId, account.id));
    expect(snapshot.balanceCents).toBe(54321);
  });

  it("keeps an asset account's sign as-is (and writes no debt snapshot)", async () => {
    const { account, connection } = await seedSyncSetup();

    // Overdrawn checking really is negative.
    mockGetAccounts.mockResolvedValue(
      sfResponse([sfAccount({ id: "sf-1", balance: "-543.21" })]),
    );
    await runSimplefinSync(connection.id);

    const [updated] = await db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(updated.currentBalanceCents).toBe(-54321);

    const debtSnapshots = await db
      .select()
      .from(debtBalanceSnapshots)
      .where(eq(debtBalanceSnapshots.accountId, account.id));
    expect(debtSnapshots).toHaveLength(0);
  });
});

describe("pending transaction date fallback", () => {
  const postedDateOf = async (accountId: string, externalId: string) => {
    const [row] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), eq(transactions.externalId, externalId)));
    return row.postedDate;
  };

  it("falls back to transacted_at when posted is 0", async () => {
    const { account, connection } = await seedSyncSetup();
    mockGetAccounts.mockResolvedValue(
      sfResponse([
        sfAccount({
          id: "sf-1",
          transactions: [
            sfTransaction({
              id: "t-pending",
              posted: 0,
              pending: true,
              transacted_at: epochSeconds("2026-07-05"),
            }),
          ],
        }),
      ]),
    );
    await runSimplefinSync(connection.id);

    expect(await postedDateOf(account.id, "t-pending")).toBe("2026-07-05");
  });

  it("falls back to today when posted is 0 and transacted_at is absent (never 1970-01-01)", async () => {
    const { account, connection } = await seedSyncSetup();
    mockGetAccounts.mockResolvedValue(
      sfResponse([
        sfAccount({
          id: "sf-1",
          transactions: [sfTransaction({ id: "t-pending", posted: 0, pending: true })],
        }),
      ]),
    );
    await runSimplefinSync(connection.id);

    // The job derives "today" in UTC; mirror that exactly.
    expect(await postedDateOf(account.id, "t-pending")).toBe(
      new Date().toISOString().slice(0, 10),
    );
  });

  it("prefers posted over transacted_at once posted", async () => {
    const { account, connection } = await seedSyncSetup();
    mockGetAccounts.mockResolvedValue(
      sfResponse([
        sfAccount({
          id: "sf-1",
          transactions: [
            sfTransaction({
              id: "t-posted",
              posted: epochSeconds("2026-07-09"),
              transacted_at: epochSeconds("2026-07-05"),
            }),
          ],
        }),
      ]),
    );
    await runSimplefinSync(connection.id);

    expect(await postedDateOf(account.id, "t-posted")).toBe("2026-07-09");
  });
});

describe("error handling", () => {
  it("per-institution errlist errors mark the run partial without disabling the connection", async () => {
    const { account, connection } = await seedSyncSetup();

    mockGetAccounts.mockResolvedValue(
      sfResponse(
        [sfAccount({ id: "sf-1", transactions: [sfTransaction({ id: "t-1" })] })],
        [{ code: "con.auth", msg: "Chase requires reauthentication" }],
      ),
    );
    await runSimplefinSync(connection.id);

    const run = await latestSyncRun(connection.id);
    expect(run.status).toBe("partial");
    expect(run.errorDetail).toContain("con.auth");

    // The connection stays in the scheduled sweep - only request-level
    // failures flip it to "error".
    const conn = await getConnection(connection.id);
    expect(conn.status).toBe("active");
    expect(conn.lastError).toContain("Chase requires reauthentication");

    // The healthy institutions on the same Access URL still synced.
    expect(await countTransactions(account.id)).toBe(1);
  });

  it("a request-level failure marks the run and connection as error", async () => {
    const { connection } = await seedSyncSetup();

    mockGetAccounts.mockRejectedValue(new Error("SimpleFin request failed: 503"));
    await runSimplefinSync(connection.id);

    const run = await latestSyncRun(connection.id);
    expect(run.status).toBe("error");
    expect(run.errorDetail).toContain("503");

    const conn = await getConnection(connection.id);
    expect(conn.status).toBe("error");
    expect(conn.lastError).toContain("503");
  });
});

describe("connection scoping", () => {
  it("the unscoped sweep syncs only active connections", async () => {
    const household = await seedHousehold(db);
    await seedSimplefinConnection(db, household.id, { status: "active" });
    await seedSimplefinConnection(db, household.id, { status: "error" });
    await seedSimplefinConnection(db, household.id, { status: "revoked" });

    // Existing active connections from other tests in this file would also
    // be swept up - retire them so the count below is exact.
    await db
      .update(simplefinConnections)
      .set({ status: "revoked" })
      .where(ne(simplefinConnections.householdId, household.id));

    mockGetAccounts.mockResolvedValue(sfResponse([]));
    await runSimplefinSync();

    expect(mockGetAccounts).toHaveBeenCalledTimes(1);
  });

  it("an explicit connectionId retries an errored connection (recovery path)", async () => {
    const household = await seedHousehold(db);
    const errored = await seedSimplefinConnection(db, household.id, { status: "error" });

    mockGetAccounts.mockResolvedValue(sfResponse([]));
    await runSimplefinSync(errored.id);

    expect(mockGetAccounts).toHaveBeenCalledTimes(1);
    expect((await latestSyncRun(errored.id)).status).toBe("success");
  });

  it("an explicit connectionId never syncs a revoked connection", async () => {
    const household = await seedHousehold(db);
    const revoked = await seedSimplefinConnection(db, household.id, { status: "revoked" });

    mockGetAccounts.mockResolvedValue(sfResponse([]));
    await runSimplefinSync(revoked.id);

    expect(mockGetAccounts).not.toHaveBeenCalled();
  });
});

describe("unmapped accounts", () => {
  it("caches the SimpleFin balance but imports nothing until mapped", async () => {
    const household = await seedHousehold(db);
    const connection = await seedSimplefinConnection(db, household.id);

    const fixture = () =>
      sfResponse([
        sfAccount({
          id: "sf-unmapped",
          balance: "250.00",
          transactions: [sfTransaction({ id: "t-1" })],
        }),
      ]);

    mockGetAccounts.mockResolvedValue(fixture());
    await runSimplefinSync(connection.id);
    // Second sync must update the auto-created row, not duplicate it
    // (unique on connectionId + simplefinAccountId).
    mockGetAccounts.mockResolvedValue(fixture());
    await runSimplefinSync(connection.id);

    const connAccounts = await db
      .select()
      .from(simplefinConnectionAccounts)
      .where(eq(simplefinConnectionAccounts.connectionId, connection.id));
    expect(connAccounts).toHaveLength(1);
    expect(connAccounts[0].simplefinAccountId).toBe("sf-unmapped");
    expect(connAccounts[0].lastSyncedBalanceCents).toBe(25000);
    expect(connAccounts[0].accountId).toBeNull();

    const householdTransactions = await db
      .select()
      .from(transactions)
      .where(eq(transactions.householdId, household.id));
    expect(householdTransactions).toHaveLength(0);
  });
});
