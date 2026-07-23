import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import {
  computeAccountBalancesAsOf,
  computePersonNetWorth,
  getPersonNetWorthHistory,
} from "@/server/db/queries/net-worth-snapshot";
import { recordPersonNetWorthSnapshots } from "@/server/jobs/net-worth-snapshot";
import { accounts } from "@/server/db/schema";
import { getTestDb, type TestDb } from "../../../../tests/helpers/pglite";
import {
  seedAccount,
  seedAccountBalanceSnapshot,
  seedAccountOwner,
  seedHousehold,
  seedLiabilityAccount,
  seedPerson,
  seedTransaction,
} from "../../../../tests/helpers/seed";

vi.mock("@/server/db/client", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/pglite");
  return { db: await createTestDb() };
});

let db: TestDb;
beforeAll(() => {
  db = getTestDb();
});

describe("computeAccountBalancesAsOf", () => {
  it("backs out an asset balance using transactions posted after asOf", async () => {
    const household = await seedHousehold(db);
    const account = await seedAccount(db, household.id, { currentBalanceCents: 10000 });
    await seedTransaction(db, household.id, account.id, {
      postedDate: "2025-06-01",
      amountCents: 2000,
    });

    const [balance] = await computeAccountBalancesAsOf(household.id, "2025-01-01");
    expect(balance.balanceCents).toBe(8000);
  });

  it("backs out a liability balance using transactions posted after asOf", async () => {
    const household = await seedHousehold(db);
    const account = await seedLiabilityAccount(db, household.id, { currentBalanceCents: 50000 });
    // A charge posted after asOf - increases what's owed between asOf and now.
    await seedTransaction(db, household.id, account.id, {
      postedDate: "2025-06-01",
      amountCents: -10000,
    });

    const [balance] = await computeAccountBalancesAsOf(household.id, "2025-01-01");
    expect(balance.balanceCents).toBe(40000);
  });

  it("falls back to the most recent snapshot at-or-before asOf when there are no transactions", async () => {
    const household = await seedHousehold(db);
    const account = await seedAccount(db, household.id, { currentBalanceCents: 99999 });
    await seedAccountBalanceSnapshot(db, account.id, {
      asOfDate: "2025-01-01",
      balanceCents: 10000,
    });
    await seedAccountBalanceSnapshot(db, account.id, {
      asOfDate: "2025-03-01",
      balanceCents: 15000,
    });

    const [balance] = await computeAccountBalancesAsOf(household.id, "2025-02-01");
    expect(balance.balanceCents).toBe(10000);
  });

  it("flat-backfills from the earliest snapshot when asOf predates all snapshots", async () => {
    const household = await seedHousehold(db);
    const account = await seedAccount(db, household.id, { currentBalanceCents: 99999 });
    await seedAccountBalanceSnapshot(db, account.id, {
      asOfDate: "2025-03-01",
      balanceCents: 15000,
    });

    const [balance] = await computeAccountBalancesAsOf(household.id, "2025-01-01");
    expect(balance.balanceCents).toBe(15000);
  });

  it("falls back to the flat current balance with neither transactions nor snapshots", async () => {
    const household = await seedHousehold(db);
    await seedAccount(db, household.id, { currentBalanceCents: 42000 });

    const [balance] = await computeAccountBalancesAsOf(household.id, "2025-01-01");
    expect(balance.balanceCents).toBe(42000);
  });
});

describe("computePersonNetWorth", () => {
  it("excludes accounts with no owners entirely", async () => {
    const household = await seedHousehold(db);
    await seedAccount(db, household.id, { currentBalanceCents: 10000 });

    const totals = await computePersonNetWorth(household.id, "2025-01-01");
    expect(totals).toEqual([]);
  });

  it("splits a 2-owner account with simple independent rounding", async () => {
    const household = await seedHousehold(db);
    const account = await seedAccount(db, household.id, { currentBalanceCents: 10001 });
    const a = await seedPerson(db, household.id, { name: "A" });
    const b = await seedPerson(db, household.id, { name: "B" });
    await seedAccountOwner(db, account.id, a.id);
    await seedAccountOwner(db, account.id, b.id);

    const totals = await computePersonNetWorth(household.id, "2025-01-01");
    const byPerson = Object.fromEntries(totals.map((t) => [t.personId, t]));
    // 10001 / 2 = 5000.5, each owner rounds independently to 5001 - the
    // accepted off-by-a-cent behavior for joint splits.
    expect(byPerson[a.id].assetsCents).toBe(5001);
    expect(byPerson[b.id].assetsCents).toBe(5001);
  });

  it("splits a 3-owner account evenly with rounding", async () => {
    const household = await seedHousehold(db);
    const account = await seedAccount(db, household.id, { currentBalanceCents: 10000 });
    const people = await Promise.all(
      ["A", "B", "C"].map((name) => seedPerson(db, household.id, { name })),
    );
    for (const person of people) {
      await seedAccountOwner(db, account.id, person.id);
    }

    const totals = await computePersonNetWorth(household.id, "2025-01-01");
    const byPerson = Object.fromEntries(totals.map((t) => [t.personId, t]));
    // 10000 / 3 = 3333.33... -> each rounds to 3333.
    for (const person of people) {
      expect(byPerson[person.id].assetsCents).toBe(3333);
    }
  });

  it("attributes liability balances to liabilitiesCents, not assetsCents", async () => {
    const household = await seedHousehold(db);
    const account = await seedLiabilityAccount(db, household.id, { currentBalanceCents: 20000 });
    const person = await seedPerson(db, household.id);
    await seedAccountOwner(db, account.id, person.id);

    const [total] = await computePersonNetWorth(household.id, "2025-01-01");
    expect(total.liabilitiesCents).toBe(20000);
    expect(total.assetsCents).toBe(0);
  });

  it("produces no row for a person who owns zero accounts", async () => {
    const household = await seedHousehold(db);
    const account = await seedAccount(db, household.id, { currentBalanceCents: 10000 });
    const owner = await seedPerson(db, household.id, { name: "Owner" });
    await seedPerson(db, household.id, { name: "No Accounts" });
    await seedAccountOwner(db, account.id, owner.id);

    const totals = await computePersonNetWorth(household.id, "2025-01-01");
    expect(totals).toHaveLength(1);
    expect(totals[0].personId).toBe(owner.id);
  });
});

describe("recordPersonNetWorthSnapshots", () => {
  it("upserts in place when re-run for the same date", async () => {
    const household = await seedHousehold(db);
    const account = await seedAccount(db, household.id, { currentBalanceCents: 10000 });
    const person = await seedPerson(db, household.id);
    await seedAccountOwner(db, account.id, person.id);

    await recordPersonNetWorthSnapshots(household.id, "2025-01-01");
    await db.update(accounts).set({ currentBalanceCents: 20000 }).where(eq(accounts.id, account.id));
    await recordPersonNetWorthSnapshots(household.id, "2025-01-01");

    const history = await getPersonNetWorthHistory(household.id, person.id);
    expect(history).toHaveLength(1);
    expect(history[0].assetsCents).toBe(20000);
  });
});
