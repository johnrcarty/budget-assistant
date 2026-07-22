import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  currentEffectiveTerms,
  getCurrentAprByAccount,
  latestKnownBalance,
  projectPayoff,
} from "@/server/db/queries/debt";
import type { debtTermsVersions } from "@/server/db/schema";
import { getTestDb, type TestDb } from "../../../../tests/helpers/pglite";
import {
  seedDebtSnapshot,
  seedDebtTerms,
  seedHousehold,
  seedLiabilityAccount,
} from "../../../../tests/helpers/seed";

vi.mock("@/server/db/client", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/pglite");
  return { db: await createTestDb() };
});

let db: TestDb;
beforeAll(() => {
  db = getTestDb();
});

async function seedDebtAccount() {
  const household = await seedHousehold(db);
  return seedLiabilityAccount(db, household.id);
}

describe("currentEffectiveTerms", () => {
  it("tolerates gaps: a months-old version is still current", async () => {
    const account = await seedDebtAccount();
    await seedDebtTerms(db, account.id, { effectiveDate: "2025-01-15", aprBps: 1999 });
    await seedDebtTerms(db, account.id, { effectiveDate: "2025-09-01", aprBps: 2499 });

    // Nothing changed between January and June - the January row applies.
    const terms = await currentEffectiveTerms(account.id, new Date("2025-06-01T12:00:00Z"));
    expect(terms?.aprBps).toBe(1999);
  });

  it("picks the later version once its effective date passes", async () => {
    const account = await seedDebtAccount();
    await seedDebtTerms(db, account.id, { effectiveDate: "2025-01-15", aprBps: 1999 });
    await seedDebtTerms(db, account.id, { effectiveDate: "2025-09-01", aprBps: 2499 });

    const terms = await currentEffectiveTerms(account.id, new Date("2025-10-01T12:00:00Z"));
    expect(terms?.aprBps).toBe(2499);
  });

  it("returns null before the first version's effective date", async () => {
    const account = await seedDebtAccount();
    await seedDebtTerms(db, account.id, { effectiveDate: "2025-01-15" });

    expect(await currentEffectiveTerms(account.id, new Date("2025-01-01T12:00:00Z"))).toBeNull();
  });

  it("includes a version effective exactly on asOf (at-or-before)", async () => {
    const account = await seedDebtAccount();
    await seedDebtTerms(db, account.id, { effectiveDate: "2025-01-15", aprBps: 1999 });

    const terms = await currentEffectiveTerms(account.id, new Date("2025-01-15T12:00:00Z"));
    expect(terms?.aprBps).toBe(1999);
  });

  it("breaks same-effective-date ties by createdAt (latest insert wins)", async () => {
    const account = await seedDebtAccount();
    // Same effective date, e.g. a correction entered later the same day.
    await seedDebtTerms(db, account.id, {
      effectiveDate: "2025-03-01",
      aprBps: 1000,
      createdAt: new Date("2025-03-01T10:00:00Z"),
    });
    await seedDebtTerms(db, account.id, {
      effectiveDate: "2025-03-01",
      aprBps: 1100,
      createdAt: new Date("2025-03-01T11:00:00Z"),
    });

    const terms = await currentEffectiveTerms(account.id, new Date("2025-04-01T12:00:00Z"));
    expect(terms?.aprBps).toBe(1100);
  });

  it("defaults asOf to now", async () => {
    const account = await seedDebtAccount();
    await seedDebtTerms(db, account.id, { effectiveDate: "2025-01-15", aprBps: 1999 });
    await seedDebtTerms(db, account.id, { effectiveDate: "2099-01-01", aprBps: 9999 });

    // The far-future version must not win today.
    const terms = await currentEffectiveTerms(account.id);
    expect(terms?.aprBps).toBe(1999);
  });
});

describe("latestKnownBalance", () => {
  it("returns a stale snapshot when months of history are missing", async () => {
    const account = await seedDebtAccount();
    await seedDebtSnapshot(db, account.id, { asOfDate: "2025-01-10", balanceCents: 500000 });

    const snapshot = await latestKnownBalance(account.id, new Date("2025-09-15T12:00:00Z"));
    expect(snapshot?.balanceCents).toBe(500000);
  });

  it("picks the most recent snapshot at or before asOf", async () => {
    const account = await seedDebtAccount();
    await seedDebtSnapshot(db, account.id, { asOfDate: "2025-01-10", balanceCents: 500000 });
    await seedDebtSnapshot(db, account.id, { asOfDate: "2025-03-05", balanceCents: 450000 });
    await seedDebtSnapshot(db, account.id, { asOfDate: "2025-06-01", balanceCents: 400000 });

    const snapshot = await latestKnownBalance(account.id, new Date("2025-05-01T12:00:00Z"));
    expect(snapshot?.balanceCents).toBe(450000);
  });

  it("breaks same-date ties across sources by createdAt", async () => {
    const account = await seedDebtAccount();
    await seedDebtSnapshot(db, account.id, {
      asOfDate: "2025-02-01",
      balanceCents: 300000,
      source: "manual",
      createdAt: new Date("2025-02-01T08:00:00Z"),
    });
    await seedDebtSnapshot(db, account.id, {
      asOfDate: "2025-02-01",
      balanceCents: 310000,
      source: "simplefin",
      createdAt: new Date("2025-02-01T09:00:00Z"),
    });

    const snapshot = await latestKnownBalance(account.id, new Date("2025-02-15T12:00:00Z"));
    expect(snapshot?.balanceCents).toBe(310000);
  });

  it("returns null with no snapshots at or before asOf", async () => {
    const account = await seedDebtAccount();
    await seedDebtSnapshot(db, account.id, { asOfDate: "2025-06-01" });

    expect(await latestKnownBalance(account.id, new Date("2025-05-01T12:00:00Z"))).toBeNull();
  });
});

describe("getCurrentAprByAccount", () => {
  it("returns the latest effective APR per account", async () => {
    const household = await seedHousehold(db);
    const a = await seedLiabilityAccount(db, household.id, { name: "A" });
    const b = await seedLiabilityAccount(db, household.id, { name: "B" });
    await seedDebtTerms(db, a.id, { effectiveDate: "2025-01-01", aprBps: 1000 });
    await seedDebtTerms(db, a.id, { effectiveDate: "2025-06-01", aprBps: 1200 });
    await seedDebtTerms(db, b.id, { effectiveDate: "2025-02-01", aprBps: 650 });

    const aprs = await getCurrentAprByAccount([a.id, b.id], new Date("2025-07-01T12:00:00Z"));
    expect(aprs).toEqual({ [a.id]: 1200, [b.id]: 650 });
  });

  it("omits accounts whose only terms are in the future", async () => {
    const household = await seedHousehold(db);
    const a = await seedLiabilityAccount(db, household.id, { name: "A" });
    const b = await seedLiabilityAccount(db, household.id, { name: "B" });
    await seedDebtTerms(db, a.id, { effectiveDate: "2025-01-01", aprBps: 1000 });
    await seedDebtTerms(db, b.id, { effectiveDate: "2099-01-01", aprBps: 9999 });

    const aprs = await getCurrentAprByAccount([a.id, b.id], new Date("2025-07-01T12:00:00Z"));
    expect(aprs).toEqual({ [a.id]: 1000 });
  });

  it("returns an empty record for no account ids", async () => {
    expect(await getCurrentAprByAccount([])).toEqual({});
  });
});

describe("projectPayoff", () => {
  // projectPayoff is pure (no DB) but reads "today" via currentMonthString()
  // for its start month, so pin the clock. No DB calls inside this block -
  // fake timers and PGlite's async internals don't mix.
  function terms(
    over: Partial<typeof debtTermsVersions.$inferSelect> = {},
  ): typeof debtTermsVersions.$inferSelect {
    return {
      id: "00000000-0000-0000-0000-000000000000",
      accountId: "00000000-0000-0000-0000-000000000001",
      effectiveDate: "2025-01-01",
      termsType: "revolving",
      aprBps: null,
      paymentFrequency: "monthly",
      minPaymentCents: null,
      minPaymentIsPercent: false,
      minPaymentPercentBps: null,
      fixedPaymentCents: null,
      escrowCents: null,
      payoffTargetDate: null,
      dueDay: null,
      servicerName: null,
      promoEndDate: null,
      note: null,
      createdAt: new Date("2025-01-01T00:00:00Z"),
      ...over,
    };
  }

  function withClockAt(iso: string, fn: () => void) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
    try {
      fn();
    } finally {
      vi.useRealTimers();
    }
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("projects a hand-checked revolving payoff", () => {
    withClockAt("2026-08-15T12:00:00", () => {
      const projection = projectPayoff(100000, terms({ aprBps: 1200, minPaymentCents: 10000 }));
      expect(projection.monthsToPayoff).toBe(11);
      expect(projection.payoffDate).toBe("2027-07-01");
      expect(Math.abs((projection.totalInterestCents ?? 0) - 5898)).toBeLessThanOrEqual(1);
      expect(projection.note).toBeUndefined();
    });
  });

  it("flags payments at or below monthly interest as negative amortization", () => {
    // $1,000 @ 36.5% -> ~$30.42/mo interest; $25 payment never gains ground.
    const projection = projectPayoff(100000, terms({ aprBps: 3650, minPaymentCents: 2500 }));
    expect(projection.monthsToPayoff).toBeNull();
    expect(projection.totalInterestCents).toBeNull();
    expect(projection.note).toMatch(/balance won't go down/);
  });

  it("asks for a minimum payment on revolving debt without one", () => {
    const projection = projectPayoff(100000, terms({ aprBps: 1999 }));
    expect(projection.monthsToPayoff).toBeNull();
    expect(projection.note).toBe("Set a minimum payment to project payoff.");
  });

  it("asks for a fixed payment or payoff date on installment debt without either", () => {
    const projection = projectPayoff(100000, terms({ termsType: "installment", aprBps: 600 }));
    expect(projection.monthsToPayoff).toBeNull();
    expect(projection.note).toBe("Set a fixed payment or payoff date to project payoff.");
  });

  it("returns zero months and interest for a zero balance", () => {
    const projection = projectPayoff(0, terms({ aprBps: 1200, minPaymentCents: 10000 }));
    expect(projection).toEqual({ monthsToPayoff: 0, payoffDate: null, totalInterestCents: 0 });
  });

  it("notes payoffs more than 50 years out instead of reporting a date", () => {
    // $1M @ 12% with a payment barely above interest: >600 months.
    const projection = projectPayoff(
      100000000,
      terms({ aprBps: 1200, minPaymentCents: 1001000 }),
    );
    expect(projection.monthsToPayoff).toBeNull();
    expect(projection.payoffDate).toBeNull();
    expect(projection.note).toMatch(/50 years/);
  });
});
