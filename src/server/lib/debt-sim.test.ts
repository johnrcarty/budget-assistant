import { describe, expect, it } from "vitest";

import {
  buildPortfolioHistory,
  monthlyEquivalentCents,
  monthlyEscrowCents,
  resolveMinPaymentCents,
  simulateDebtPlan,
  type SimDebtInput,
  type SimTerms,
} from "@/server/lib/debt-sim";

// The engine is pure and takes startMonth explicitly - no clock, no mocks.
const START = "2026-08-01";

function revolving(over: Partial<SimTerms> = {}): SimTerms {
  return {
    termsType: "revolving",
    aprBps: null,
    paymentFrequency: "monthly",
    minPaymentCents: null,
    minPaymentIsPercent: false,
    minPaymentPercentBps: null,
    fixedPaymentCents: null,
    escrowCents: null,
    payoffTargetDate: null,
    promoEndDate: null,
    ...over,
  };
}

function installment(over: Partial<SimTerms> = {}): SimTerms {
  return revolving({ termsType: "installment", ...over });
}

function debt(over: Partial<SimDebtInput> & { accountId: string }): SimDebtInput {
  return {
    name: over.accountId,
    balanceCents: 0,
    originalBalanceCents: null,
    terms: null,
    budgetedMonthlyCents: null,
    ...over,
  };
}

function run(debts: SimDebtInput[], strategy: "snowball" | "avalanche" = "snowball", extra = 0) {
  return simulateDebtPlan({ debts, strategy, extraMonthlyCents: extra, startMonth: START });
}

describe("simulateDebtPlan: hand-checked amortization", () => {
  // $1,000 @ 12% APR, $100/mo minimum.
  // Month 1: $10.00 interest -> $910 after payment; month 2 -> $819.10; ...
  // 11 months, $58.98 total interest (58.9848 exactly).
  const result = run([
    debt({
      accountId: "a",
      balanceCents: 100000,
      terms: revolving({ aprBps: 1200, minPaymentCents: 10000 }),
    }),
  ]);
  const d = result.debts[0];

  it("pays off in 11 months", () => {
    expect(d.monthsToPayoff).toBe(11);
  });

  it("accrues 5898c total interest (±1c float rounding)", () => {
    expect(Math.abs((d.totalInterestCents ?? 0) - 5898)).toBeLessThanOrEqual(1);
  });

  it("reports payoff month 2027-07-01", () => {
    expect(d.payoffMonth).toBe("2027-07-01");
  });

  it("starts the timeline at the start month with the full balance", () => {
    expect(result.timeline[0]).toMatchObject({ month: START, totalCents: 100000 });
  });
});

describe("simulateDebtPlan: biweekly payment frequency", () => {
  it("converts biweekly as 26 payments/yr, not 24", () => {
    expect(monthlyEquivalentCents(10000, "biweekly")).toBe(21667);
  });

  const biweekly = run([
    debt({
      accountId: "a",
      balanceCents: 100000,
      terms: revolving({ aprBps: 1200, minPaymentCents: 10000, paymentFrequency: "biweekly" }),
    }),
  ]).debts[0];
  const monthlyEq = run([
    debt({
      accountId: "a",
      balanceCents: 100000,
      terms: revolving({ aprBps: 1200, minPaymentCents: 21667 }),
    }),
  ]).debts[0];
  const twoPerMonth = run([
    debt({
      accountId: "a",
      balanceCents: 100000,
      terms: revolving({ aprBps: 1200, minPaymentCents: 20000 }),
    }),
  ]).debts[0];

  it("runs a $100-biweekly debt identically to its $216.67/mo equivalent", () => {
    expect(biweekly.monthsToPayoff).toBe(monthlyEq.monthsToPayoff);
    expect(biweekly.totalInterestCents).toBe(monthlyEq.totalInterestCents);
  });

  it("is strictly faster/cheaper than a 2x-per-month misreading", () => {
    expect(biweekly.monthsToPayoff ?? 99).toBeLessThanOrEqual(twoPerMonth.monthsToPayoff ?? 99);
    expect(biweekly.totalInterestCents ?? 1e9).toBeLessThan(twoPerMonth.totalInterestCents ?? 0);
  });
});

describe("simulateDebtPlan: snowball rollover", () => {
  // A $500 @0% min $50, B $1,000 @0% min $100, extra $50.
  // A dies month 5; from month 6 B gets $200/mo; debt-free month 8.
  // Baseline (minimums only, no extra/rollover): 10 months.
  const result = run(
    [
      debt({ accountId: "A", balanceCents: 50000, terms: revolving({ minPaymentCents: 5000 }) }),
      debt({ accountId: "B", balanceCents: 100000, terms: revolving({ minPaymentCents: 10000 }) }),
    ],
    "snowball",
    5000,
  );
  const a = result.debts.find((d) => d.accountId === "A")!;
  const b = result.debts.find((d) => d.accountId === "B")!;

  it("orders smallest balance first", () => {
    expect(result.order).toEqual(["A", "B"]);
  });

  it("pays A off in month 5", () => {
    expect(a.monthsToPayoff).toBe(5);
  });

  it("rolls A's payment into B, paying B off in month 8", () => {
    expect(b.monthsToPayoff).toBe(8);
  });

  it("is debt-free 2027-04-01, two months sooner than the minimums-only baseline", () => {
    expect(result.debtFreeMonth).toBe("2027-04-01");
    expect(result.baseline.debtFreeMonth).toBe("2027-06-01");
    expect(result.monthsSooner).toBe(2);
  });

  it("saves no interest at 0% APR", () => {
    expect(result.interestSavedCents).toBe(0);
  });

  it("reports the monthly commitment as minimums + extra", () => {
    expect(result.monthlyCommitmentCents).toBe(20000);
  });
});

describe("simulateDebtPlan: strategy ordering", () => {
  const debts = () => [
    debt({
      accountId: "small-low",
      balanceCents: 50000,
      terms: revolving({ aprBps: 500, minPaymentCents: 2500 }),
    }),
    debt({
      accountId: "big-high",
      balanceCents: 200000,
      terms: revolving({ aprBps: 2500, minPaymentCents: 6000 }),
    }),
  ];
  const snow = run(debts(), "snowball", 20000);
  const aval = run(debts(), "avalanche", 20000);

  it("snowball targets the smallest balance first", () => {
    expect(snow.order[0]).toBe("small-low");
  });

  it("avalanche targets the highest APR first", () => {
    expect(aval.order[0]).toBe("big-high");
  });

  it("avalanche never pays more interest than snowball", () => {
    expect(aval.totalInterestCents).toBeLessThanOrEqual(snow.totalInterestCents);
  });
});

describe("simulateDebtPlan: guards", () => {
  it("applies the dollar floor to percent-of-balance minimums", () => {
    const percentTerms = {
      minPaymentCents: 2500,
      minPaymentIsPercent: true,
      minPaymentPercentBps: 200,
    };
    // 2% of $1,000 = $20 < $25 floor
    expect(resolveMinPaymentCents(100000, percentTerms)).toBe(2500);
    // 2% of $10,000 = $200 > floor
    expect(resolveMinPaymentCents(1000000, percentTerms)).toBe(20000);
  });

  const result = run([
    debt({
      accountId: "negam",
      balanceCents: 100000,
      terms: revolving({ aprBps: 3650, minPaymentCents: 2500 }),
    }),
    debt({ accountId: "fine", balanceCents: 50000, terms: revolving({ minPaymentCents: 5000 }) }),
    debt({ accountId: "noterms", balanceCents: 30000 }),
    debt({ accountId: "done", balanceCents: 0, terms: revolving({ minPaymentCents: 1000 }) }),
  ]);
  const status = (id: string) => result.debts.find((d) => d.accountId === id)?.status;

  it("flags and excludes negative amortization (payment below interest accrued)", () => {
    expect(status("negam")).toBe("negative_amortization");
    expect(
      result.warnings.some((w) => w.accountId === "negam" && w.kind === "negative_amortization"),
    ).toBe(true);
  });

  it("flags and excludes debts with no terms", () => {
    expect(status("noterms")).toBe("needs_terms");
    expect(result.warnings.some((w) => w.accountId === "noterms" && w.kind === "needs_terms")).toBe(
      true,
    );
  });

  it("marks zero balances paid_off", () => {
    expect(status("done")).toBe("paid_off");
  });

  it("computes the debt-free date over simulatable debts only", () => {
    expect(result.debtFreeMonth).toBe("2027-06-01");
    expect(result.order).toHaveLength(1);
  });

  it("caps at 600 months with a warning and no debt-free date", () => {
    const capped = run([
      debt({
        accountId: "huge",
        balanceCents: 100000000,
        terms: revolving({ aprBps: 1200, minPaymentCents: 1001000 }),
      }),
    ]);
    expect(capped.warnings.some((w) => w.kind === "capped")).toBe(true);
    expect(capped.debtFreeMonth).toBeNull();
  });

  it("warns when budgeted below minimum but still pays the true minimum", () => {
    const budget = run([
      debt({
        accountId: "under",
        balanceCents: 100000,
        budgetedMonthlyCents: 2000,
        terms: revolving({ aprBps: 1200, minPaymentCents: 10000 }),
      }),
    ]);
    expect(budget.warnings.some((w) => w.kind === "budget_below_minimum")).toBe(true);
    expect(budget.debts[0].monthsToPayoff).toBe(11);
  });
});

describe("simulateDebtPlan: escrow passthrough", () => {
  // $100k @ 6% with a $1,000 payment of which $400 is escrow -> only $600
  // attacks principal+interest.
  const noEscrow = run([
    debt({
      accountId: "m",
      balanceCents: 10000000,
      terms: installment({ aprBps: 600, fixedPaymentCents: 60000 }),
    }),
  ]).debts[0];
  const withEscrow = run([
    debt({
      accountId: "m",
      balanceCents: 10000000,
      terms: installment({ aprBps: 600, fixedPaymentCents: 100000, escrowCents: 40000 }),
    }),
  ]).debts[0];

  it("excludes escrow from payoff math", () => {
    expect(withEscrow.monthsToPayoff).toBe(noEscrow.monthsToPayoff);
    expect(withEscrow.totalInterestCents).toBe(noEscrow.totalInterestCents);
  });

  it("escrow-nets a gross budgeted amount (no phantom extra principal)", () => {
    // A linked budget item carries the GROSS payment; the sim must not read
    // the escrow portion as extra principal.
    const budgetedGross = run([
      debt({
        accountId: "m",
        balanceCents: 10000000,
        budgetedMonthlyCents: 100000,
        terms: installment({ aprBps: 600, fixedPaymentCents: 100000, escrowCents: 40000 }),
      }),
    ]).debts[0];
    expect(budgetedGross.monthsToPayoff).toBe(withEscrow.monthsToPayoff);
  });

  it("still accelerates payoff when budgeting above the gross payment", () => {
    const budgetedExtra = run([
      debt({
        accountId: "m",
        balanceCents: 10000000,
        budgetedMonthlyCents: 120000,
        terms: installment({ aprBps: 600, fixedPaymentCents: 100000, escrowCents: 40000 }),
      }),
    ]).debts[0];
    expect(budgetedExtra.monthsToPayoff ?? 999).toBeLessThan(withEscrow.monthsToPayoff ?? 0);
  });

  it("treats escrow >= payment as needs_terms", () => {
    const swallowed = run([
      debt({
        accountId: "m",
        balanceCents: 10000000,
        terms: installment({ fixedPaymentCents: 30000, escrowCents: 40000 }),
      }),
    ]).debts[0];
    expect(swallowed.status).toBe("needs_terms");
  });

  it("converts biweekly escrow like payments", () => {
    expect(
      monthlyEscrowCents(installment({ paymentFrequency: "biweekly", escrowCents: 10000 })),
    ).toBe(21667);
  });
});

describe("buildPortfolioHistory", () => {
  const points = buildPortfolioHistory(
    new Map([
      [
        "acc1",
        [
          { asOfDate: "2026-01-15", balanceCents: 100000 },
          { asOfDate: "2026-03-10", balanceCents: 90000 },
        ],
      ],
      ["acc2", [{ asOfDate: "2026-02-01", balanceCents: 50000 }]],
    ]),
    ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"],
  );

  it("starts the series at the later first-snapshot date (skips Jan)", () => {
    expect(points.map((p) => p.date)).toEqual(["2026-02-01", "2026-03-01", "2026-04-01"]);
  });

  it("carries balances forward between snapshots", () => {
    expect(points.map((p) => p.totalCents)).toEqual([150000, 150000, 140000]);
  });
});
