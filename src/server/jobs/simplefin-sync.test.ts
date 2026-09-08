import { and, eq, ne } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeWindowStart,
  connIdsMatch,
  MAX_WINDOW_SECONDS,
  runSimplefinSync,
} from "@/server/jobs/simplefin-sync";
import {
  accountBalanceSnapshots,
  accounts,
  debtBalanceSnapshots,
  simplefinConnectionAccounts,
  simplefinConnections,
  syncRuns,
  transactions,
  transactionExclusions,
} from "@/server/db/schema";
import { deleteTransactionById } from "@/server/db/queries/transactions";
import { getSimplefinAccounts, SimplefinRequestError } from "@/server/lib/simplefin/client";
import { getTestDb, type TestDb } from "../../../tests/helpers/pglite";
import {
  seedAccount,
  seedConnectionAccount,
  seedHousehold,
  seedLiabilityAccount,
  seedRule,
  seedSimplefinConnection,
  seedTransaction,
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

vi.mock("@/server/lib/simplefin/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/lib/simplefin/client")>();
  return { ...actual, claimAccessUrl: vi.fn(), getSimplefinAccounts: vi.fn() };
});

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

  it("a deleted synced transaction stays deleted when the feed still returns it", async () => {
    const { household, account, connection } = await seedSyncSetup();
    const fixture = () =>
      sfResponse([
        sfAccount({
          id: "sf-1",
          transactions: [
            // A feed row the user decided doesn't belong in their ledger.
            // (The original Fidelity case that prompted this turned out to be
            // a sign error, not a phantom - see "forced inflow" below - but
            // "deleted stays deleted" is the general guarantee.)
            sfTransaction({ id: "t-phantom", amount: "-2669.52", posted: epochSeconds("2026-07-22") }),
            sfTransaction({ id: "t-real", amount: "-45.00", posted: epochSeconds("2026-07-23") }),
          ],
        }),
      ]);

    mockGetAccounts.mockResolvedValue(fixture());
    await runSimplefinSync(connection.id);
    expect(await countTransactions(account.id)).toBe(2);

    const [phantom] = await db
      .select()
      .from(transactions)
      .where(
        and(eq(transactions.accountId, account.id), eq(transactions.externalId, "t-phantom")),
      );
    expect(await deleteTransactionById(household.id, phantom.id)).toBe(true);

    // The tombstone carries the feed identity plus a snapshot of the row.
    const [exclusion] = await db
      .select()
      .from(transactionExclusions)
      .where(eq(transactionExclusions.accountId, account.id));
    expect(exclusion).toMatchObject({
      source: "simplefin",
      externalId: "t-phantom",
      amountCents: -266952,
      postedDate: "2026-07-22",
    });

    mockGetAccounts.mockResolvedValue(fixture());
    await runSimplefinSync(connection.id);

    const remaining = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, account.id));
    expect(remaining.map((row) => row.externalId)).toEqual(["t-real"]);
  });
});

// Fidelity's feed reports deposit-class inflows (payroll direct deposits,
// 401k contributions) as negative while signing its outflows correctly, so
// the correction is per-description, not per-account.
describe("forced inflow sign correction", () => {
  const payroll = (id: string, amount: string) =>
    sfResponse([
      sfAccount({
        id: "sf-1",
        transactions: [
          sfTransaction({
            id,
            amount,
            description: "DIRECT DEPOSIT PROGRESSIVE PAYROLL (Cash)",
            posted: epochSeconds("2026-08-05"),
          }),
        ],
      }),
    ]);

  const amountOf = async (accountId: string, externalId: string) => {
    const [row] = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, accountId),
          eq(transactions.externalId, externalId),
        ),
      );
    return row.amountCents;
  };

  it("stores a matching negative deposit as positive", async () => {
    const { household, account, connection } = await seedSyncSetup();
    await seedRule(db, household.id, {
      pattern: "DIRECT DEPOSIT PROGRESSIVE",
      matchType: "starts_with",
      accountId: account.id,
      forceInflow: true,
    });

    mockGetAccounts.mockResolvedValue(payroll("t-pay", "-2669.53"));
    await runSimplefinSync(connection.id);

    expect(await amountOf(account.id, "t-pay")).toBe(266953);
  });

  it("leaves the sign alone when no rule matches", async () => {
    const { account, connection } = await seedSyncSetup();

    mockGetAccounts.mockResolvedValue(payroll("t-pay", "-2669.53"));
    await runSimplefinSync(connection.id);

    expect(await amountOf(account.id, "t-pay")).toBe(-266953);
  });

  it("does not touch outflows on the same account", async () => {
    const { household, account, connection } = await seedSyncSetup();
    await seedRule(db, household.id, {
      pattern: "DIRECT DEPOSIT PROGRESSIVE",
      matchType: "starts_with",
      accountId: account.id,
      forceInflow: true,
    });

    mockGetAccounts.mockResolvedValue(
      sfResponse([
        sfAccount({
          id: "sf-1",
          transactions: [
            sfTransaction({
              id: "t-purchase",
              amount: "-46.20",
              description: "DEBIT CARD PURCHASE SPEEDWAY 45 (Cash)",
              posted: epochSeconds("2026-08-05"),
            }),
          ],
        }),
      ]),
    );
    await runSimplefinSync(connection.id);

    expect(await amountOf(account.id, "t-purchase")).toBe(-4620);
  });

  it("is a no-op on an already-positive match, and survives re-sync", async () => {
    const { household, account, connection } = await seedSyncSetup();
    await seedRule(db, household.id, {
      pattern: "DIRECT DEPOSIT PROGRESSIVE",
      matchType: "starts_with",
      accountId: account.id,
      forceInflow: true,
    });

    // Feed corrected upstream: force-inflow must not flip it back negative.
    mockGetAccounts.mockResolvedValue(payroll("t-ok", "2669.53"));
    await runSimplefinSync(connection.id);
    expect(await amountOf(account.id, "t-ok")).toBe(266953);

    // And the upsert path re-derives from the raw amount, so a still-negative
    // feed row stays corrected across syncs rather than drifting back.
    mockGetAccounts.mockResolvedValue(payroll("t-pay", "-2669.53"));
    await runSimplefinSync(connection.id);
    mockGetAccounts.mockResolvedValue(payroll("t-pay", "-2669.53"));
    await runSimplefinSync(connection.id);
    expect(await amountOf(account.id, "t-pay")).toBe(266953);
  });

  it("only applies to the account the rule is scoped to", async () => {
    const { household, account, connection } = await seedSyncSetup();
    const other = await seedAccount(db, household.id, { name: "Other Checking" });
    await seedConnectionAccount(db, connection, "sf-2", { accountId: other.id });
    await seedRule(db, household.id, {
      pattern: "DIRECT DEPOSIT PROGRESSIVE",
      matchType: "starts_with",
      accountId: account.id,
      forceInflow: true,
    });

    mockGetAccounts.mockResolvedValue(
      sfResponse([
        sfAccount({
          id: "sf-2",
          transactions: [
            sfTransaction({
              id: "t-elsewhere",
              amount: "-2669.53",
              description: "DIRECT DEPOSIT PROGRESSIVE PAYROLL (Cash)",
              posted: epochSeconds("2026-08-05"),
            }),
          ],
        }),
      ]),
    );
    await runSimplefinSync(connection.id);

    expect(await amountOf(other.id, "t-elsewhere")).toBe(-266953);
  });
});

// Since 2026-07-27 the same feed reports debit-card purchases as POSITIVE.
describe("forced outflow sign correction", () => {
  const purchase = (id: string, amount: string, posted = "2026-08-05") =>
    sfResponse([
      sfAccount({
        id: "sf-1",
        transactions: [
          sfTransaction({
            id,
            amount,
            description: "DEBIT CARD PURCHASE STARBUCKS 8007827282 (Cash)",
            posted: epochSeconds(posted),
          }),
        ],
      }),
    ]);

  const amountOf = async (accountId: string, externalId: string) => {
    const [row] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), eq(transactions.externalId, externalId)));
    return row.amountCents;
  };

  it("stores a matching positive purchase as negative", async () => {
    const { household, account, connection } = await seedSyncSetup();
    await seedRule(db, household.id, {
      pattern: "DEBIT CARD PURCHASE",
      matchType: "starts_with",
      accountId: account.id,
      forceOutflow: true,
    });

    mockGetAccounts.mockResolvedValue(purchase("t-sbux", "10.00"));
    await runSimplefinSync(connection.id);

    expect(await amountOf(account.id, "t-sbux")).toBe(-1000);
  });

  it("re-derives rows OUTSIDE the sync window from their raw payload", async () => {
    const { household, account, connection } = await seedSyncSetup();
    // A row synced months ago, before the feed flipped and before any rule
    // existed: stored positive, raw positive. The feed won't send it again.
    const old = await seedTransaction(db, household.id, account.id, {
      amountCents: 12330,
      description: "DEBIT CARD PURCHASE LOWE'S #00 (Cash)",
      postedDate: "2026-08-01",
      source: "simplefin",
      externalId: "t-old",
      rawPayload: { id: "t-old", amount: "123.30", description: "DEBIT CARD PURCHASE LOWE'S #00 (Cash)" },
    });
    await seedRule(db, household.id, {
      pattern: "DEBIT CARD PURCHASE",
      matchType: "starts_with",
      accountId: account.id,
      forceOutflow: true,
    });

    // Today's sync carries nothing for that row.
    mockGetAccounts.mockResolvedValue(sfResponse([sfAccount({ id: "sf-1" })]));
    await runSimplefinSync(connection.id);

    const [row] = await db.select().from(transactions).where(eq(transactions.id, old.id));
    expect(row.amountCents).toBe(-12330);
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

  it("a transient request failure (5xx, timeout) records the error but keeps the connection active", async () => {
    const { connection } = await seedSyncSetup();

    mockGetAccounts.mockRejectedValue(
      new SimplefinRequestError("SimpleFin /accounts failed: 524: A timeout occurred", 524),
    );
    await runSimplefinSync(connection.id);

    const run = await latestSyncRun(connection.id);
    expect(run.status).toBe("error");
    expect(run.errorDetail).toContain("524");

    // Still in the scheduled sweep: the next cron run retries on its own.
    const conn = await getConnection(connection.id);
    expect(conn.status).toBe("active");
    expect(conn.lastError).toContain("524: A timeout occurred");
  });

  it("a rejected credential (401/403) takes the connection out of the sweep", async () => {
    const { connection } = await seedSyncSetup();

    mockGetAccounts.mockRejectedValue(
      new SimplefinRequestError("SimpleFin /accounts failed: 403 Forbidden", 403),
    );
    await runSimplefinSync(connection.id);

    expect((await latestSyncRun(connection.id)).status).toBe("error");
    const conn = await getConnection(connection.id);
    expect(conn.status).toBe("error");
    expect(conn.lastError).toContain("403");
  });

  it("a clean run clears the connection's last error", async () => {
    const { connection } = await seedSyncSetup();
    await db
      .update(simplefinConnections)
      .set({ lastError: "old news" })
      .where(eq(simplefinConnections.id, connection.id));

    mockGetAccounts.mockResolvedValue(sfResponse([sfAccount({ id: "sf-1" })]));
    await runSimplefinSync(connection.id);

    expect((await getConnection(connection.id)).lastError).toBeNull();
  });
});

describe("transaction window", () => {
  const DAY = 24 * 60 * 60;
  const now = epochSeconds("2026-09-05");

  it("first-ever sync asks for the protocol's ~90-day maximum", () => {
    expect(computeWindowStart(null, now)).toBe(now - 89 * DAY);
  });

  it("a later sync starts 3 days before the last run that reached SimpleFin", () => {
    const lastRun = new Date((now - 1 * DAY) * 1000);
    expect(computeWindowStart(lastRun, now)).toBe(now - 4 * DAY);
  });

  it("never asks for more than SimpleFin's recommended 45 days, however stale", () => {
    const lastRun = new Date((now - 120 * DAY) * 1000);
    expect(computeWindowStart(lastRun, now)).toBe(now - MAX_WINDOW_SECONDS);
  });

  it("bases the window on the last non-error run, not on a stuck account's lastSyncedAt", async () => {
    const { connection } = await seedSyncSetup();
    // The stuck-institution scenario: one account last seen months ago...
    await seedConnectionAccount(db, connection, "sf-stuck", {
      lastSyncedAt: new Date("2026-05-01T00:00:00Z"),
    });
    // ...but the connection itself reached SimpleFin yesterday (partial),
    // and an even more recent run that never got through doesn't count.
    const yesterday = new Date(Date.now() - 1 * DAY * 1000);
    await db.insert(syncRuns).values([
      { connectionId: connection.id, startedAt: yesterday, status: "partial" },
      { connectionId: connection.id, startedAt: new Date(), status: "error" },
    ]);

    mockGetAccounts.mockResolvedValue(sfResponse([]));
    await runSimplefinSync(connection.id);

    const opts = mockGetAccounts.mock.calls[0][1]!;
    const expected = Math.floor(yesterday.getTime() / 1000) - 3 * DAY;
    expect(Math.abs(opts.startDate! - expected)).toBeLessThan(5);
  });
});

describe("per-account sync issues", () => {
  it("pins an errlist entry to the accounts behind that institution and clears it when healthy", async () => {
    const { account, connection } = await seedSyncSetup();

    // First run: account reports its conn_id and its institution is broken.
    mockGetAccounts.mockResolvedValue(
      sfResponse(
        [sfAccount({ id: "sf-1", conn_id: "MBR-1" })],
        [{ code: "con.auth", msg: "Auth required", conn_id: "MBR-1" }],
      ),
    );
    await runSimplefinSync(connection.id);

    let [ca] = await db
      .select()
      .from(simplefinConnectionAccounts)
      .where(eq(simplefinConnectionAccounts.accountId, account.id));
    expect(ca.simplefinConnId).toBe("MBR-1");
    expect(ca.syncIssue).toBe("con.auth: Auth required");

    // Second run: institution still broken and its account has dropped out
    // of the feed entirely - the stored conn_id keeps the flag on.
    mockGetAccounts.mockResolvedValue(
      sfResponse([], [{ code: "con.auth", msg: "Auth required", conn_id: "MBR-1" }]),
    );
    await runSimplefinSync(connection.id);
    [ca] = await db
      .select()
      .from(simplefinConnectionAccounts)
      .where(eq(simplefinConnectionAccounts.accountId, account.id));
    expect(ca.syncIssue).toBe("con.auth: Auth required");

    // Third run: reconnected at SimpleFin - flag clears.
    mockGetAccounts.mockResolvedValue(sfResponse([sfAccount({ id: "sf-1", conn_id: "MBR-1" })]));
    await runSimplefinSync(connection.id);
    [ca] = await db
      .select()
      .from(simplefinConnectionAccounts)
      .where(eq(simplefinConnectionAccounts.accountId, account.id));
    expect(ca.syncIssue).toBeNull();
  });

  it("matches the bridge's aggregator-prefixed account conn_id to the errlist conn_id", async () => {
    expect(connIdsMatch("MX-MBR-8cd0b6af", "MBR-8cd0b6af")).toBe(true);
    expect(connIdsMatch("MBR-8cd0b6af", "MX-MBR-8cd0b6af")).toBe(true);
    expect(connIdsMatch("MX-MBR-8cd0b6af", "MBR-8cd0b6af-other")).toBe(false);
    expect(connIdsMatch("MX-MBR-1", "MBR-2")).toBe(false);

    const { account, connection } = await seedSyncSetup();
    mockGetAccounts.mockResolvedValue(
      sfResponse(
        [sfAccount({ id: "sf-1", conn_id: "MX-MBR-8cd0b6af" })],
        [{ code: "con.auth", msg: "Auth required", conn_id: "MBR-8cd0b6af" }],
      ),
    );
    await runSimplefinSync(connection.id);
    const [ca] = await db
      .select()
      .from(simplefinConnectionAccounts)
      .where(eq(simplefinConnectionAccounts.accountId, account.id));
    expect(ca.syncIssue).toBe("con.auth: Auth required");
  });

  it("leaves accounts from healthy institutions unflagged", async () => {
    const { account, connection } = await seedSyncSetup();
    mockGetAccounts.mockResolvedValue(
      sfResponse(
        [sfAccount({ id: "sf-1", conn_id: "MBR-healthy" })],
        [{ code: "con.auth", msg: "Auth required", conn_id: "MBR-other" }],
      ),
    );
    await runSimplefinSync(connection.id);
    const [ca] = await db
      .select()
      .from(simplefinConnectionAccounts)
      .where(eq(simplefinConnectionAccounts.accountId, account.id));
    expect(ca.syncIssue).toBeNull();
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
    // ...and it rejoins the scheduled sweep.
    expect((await getConnection(errored.id)).status).toBe("active");
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
