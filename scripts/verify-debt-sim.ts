// Deterministic checks for the pure debt payoff engine. No DB, no DAL.
// Run: npx tsx scripts/verify-debt-sim.ts

import {
  simulateDebtPlan,
  monthlyEquivalentCents,
  resolveMinPaymentCents,
  buildPortfolioHistory,
  type SimDebtInput,
  type SimTerms,
} from "@/server/lib/debt-sim";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` :: ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

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
    payoffTargetDate: null,
    promoEndDate: null,
    ...over,
  };
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

// 1. Hand-checkable single debt: $1,000 @ 12% APR, $100/mo minimum.
//    Month 1: $10.00 interest -> $910 after payment; month 2 -> $819.10; ...
//    11 months, $58.98 total interest (58.9848 exactly, rounded to 5898c).
{
  const r = run([
    debt({ accountId: "a", balanceCents: 100000, terms: revolving({ aprBps: 1200, minPaymentCents: 10000 }) }),
  ]);
  const d = r.debts[0];
  check("1. months === 11", d.monthsToPayoff === 11, d);
  check("1. interest === 5898c (±1)", Math.abs((d.totalInterestCents ?? 0) - 5898) <= 1, d.totalInterestCents);
  check("1. payoffMonth = 2027-07-01", d.payoffMonth === "2027-07-01", d.payoffMonth);
  check("1. timeline starts at start month with full balance",
    r.timeline[0].month === START && r.timeline[0].totalCents === 100000, r.timeline[0]);
}

// 2. Biweekly conversion: 26 payments/yr, not 24.
{
  check("2. monthlyEquivalent($100 biweekly) === 21667c", monthlyEquivalentCents(10000, "biweekly") === 21667);
  const biweekly = run([
    debt({ accountId: "a", balanceCents: 100000, terms: revolving({ aprBps: 1200, minPaymentCents: 10000, paymentFrequency: "biweekly" }) }),
  ]).debts[0];
  const monthlyEq = run([
    debt({ accountId: "a", balanceCents: 100000, terms: revolving({ aprBps: 1200, minPaymentCents: 21667 }) }),
  ]).debts[0];
  const twoPerMonth = run([
    debt({ accountId: "a", balanceCents: 100000, terms: revolving({ aprBps: 1200, minPaymentCents: 20000 }) }),
  ]).debts[0];
  check("2. biweekly run identical to $216.67/mo run",
    biweekly.monthsToPayoff === monthlyEq.monthsToPayoff &&
      biweekly.totalInterestCents === monthlyEq.totalInterestCents,
    { biweekly, monthlyEq });
  check("2. biweekly strictly faster/cheaper than 2x-per-month reading",
    (biweekly.monthsToPayoff ?? 99) <= (twoPerMonth.monthsToPayoff ?? 99) &&
      (biweekly.totalInterestCents ?? 1e9) < (twoPerMonth.totalInterestCents ?? 0),
    { biweekly, twoPerMonth });
}

// 3. Rollover: A $500 @0% min $50, B $1,000 @0% min $100, extra $50.
//    A dies month 5; from month 6 B gets $200/mo; debt-free month 8.
//    Baseline (minimums only, no extra/rollover): 10 months. 2 months sooner.
{
  const r = run(
    [
      debt({ accountId: "A", balanceCents: 50000, terms: revolving({ minPaymentCents: 5000 }) }),
      debt({ accountId: "B", balanceCents: 100000, terms: revolving({ minPaymentCents: 10000 }) }),
    ],
    "snowball",
    5000,
  );
  const a = r.debts.find((d) => d.accountId === "A")!;
  const b = r.debts.find((d) => d.accountId === "B")!;
  check("3. order is [A, B] (snowball)", r.order.join(",") === "A,B", r.order);
  check("3. A dies month 5", a.monthsToPayoff === 5, a);
  check("3. B dies month 8 (rollover)", b.monthsToPayoff === 8, b);
  check("3. debt-free 2027-04-01", r.debtFreeMonth === "2027-04-01", r.debtFreeMonth);
  check("3. baseline debt-free 10 months (2027-06-01)", r.baseline.debtFreeMonth === "2027-06-01", r.baseline);
  check("3. monthsSooner === 2", r.monthsSooner === 2, r.monthsSooner);
  check("3. interestSaved === 0 (0% APR)", r.interestSavedCents === 0, r.interestSavedCents);
  check("3. commitment = 50+100+50 extra", r.monthlyCommitmentCents === 20000, r.monthlyCommitmentCents);
}

// 4. Strategy flip + avalanche never pays more interest.
{
  const debts = () => [
    debt({ accountId: "small-low", balanceCents: 50000, terms: revolving({ aprBps: 500, minPaymentCents: 2500 }) }),
    debt({ accountId: "big-high", balanceCents: 200000, terms: revolving({ aprBps: 2500, minPaymentCents: 6000 }) }),
  ];
  const snow = run(debts(), "snowball", 20000);
  const aval = run(debts(), "avalanche", 20000);
  check("4. snowball targets small-low first", snow.order[0] === "small-low", snow.order);
  check("4. avalanche targets big-high first", aval.order[0] === "big-high", aval.order);
  check("4. avalanche interest <= snowball interest",
    aval.totalInterestCents <= snow.totalInterestCents,
    { aval: aval.totalInterestCents, snow: snow.totalInterestCents });
}

// 5. Guards.
{
  check("5. percent min with $25 floor", resolveMinPaymentCents(100000, {
    minPaymentCents: 2500, minPaymentIsPercent: true, minPaymentPercentBps: 200,
  }) === 2500);
  check("5. percent min above floor", resolveMinPaymentCents(1000000, {
    minPaymentCents: 2500, minPaymentIsPercent: true, minPaymentPercentBps: 200,
  }) === 20000);

  const r = run([
    debt({ accountId: "negam", balanceCents: 100000, terms: revolving({ aprBps: 3650, minPaymentCents: 2500 }) }),
    debt({ accountId: "fine", balanceCents: 50000, terms: revolving({ minPaymentCents: 5000 }) }),
    debt({ accountId: "noterms", balanceCents: 30000 }),
    debt({ accountId: "done", balanceCents: 0, terms: revolving({ minPaymentCents: 1000 }) }),
  ]);
  const status = (id: string) => r.debts.find((d) => d.accountId === id)?.status;
  check("5. negative amortization flagged + excluded",
    status("negam") === "negative_amortization" && r.warnings.some((w) => w.accountId === "negam" && w.kind === "negative_amortization"));
  check("5. needs_terms flagged + excluded",
    status("noterms") === "needs_terms" && r.warnings.some((w) => w.accountId === "noterms" && w.kind === "needs_terms"));
  check("5. zero balance = paid_off", status("done") === "paid_off");
  check("5. debt-free date only reflects simulatable debts",
    r.debtFreeMonth === "2027-06-01" && r.order.length === 1, r.debtFreeMonth);

  const capped = run([
    debt({ accountId: "huge", balanceCents: 100000000, terms: revolving({ aprBps: 1200, minPaymentCents: 1001000 }) }),
  ]);
  check("5. 600-month cap flags capped, no debt-free date",
    capped.warnings.some((w) => w.kind === "capped") && capped.debtFreeMonth === null, capped.warnings);

  const budget = run([
    debt({ accountId: "under", balanceCents: 100000, budgetedMonthlyCents: 2000, terms: revolving({ aprBps: 1200, minPaymentCents: 10000 }) }),
  ]);
  check("5. budget below minimum warns but pays true minimum",
    budget.warnings.some((w) => w.kind === "budget_below_minimum") &&
      budget.debts[0].monthsToPayoff === 11, budget.debts[0]);
}

// 6. buildPortfolioHistory carry-forward + series-start rule.
{
  const points = buildPortfolioHistory(
    new Map([
      ["acc1", [
        { asOfDate: "2026-01-15", balanceCents: 100000 },
        { asOfDate: "2026-03-10", balanceCents: 90000 },
      ]],
      ["acc2", [{ asOfDate: "2026-02-01", balanceCents: 50000 }]],
    ]),
    ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"],
  );
  check("6. series starts at later first-snapshot (skips Jan)",
    points.length === 3 && points[0].date === "2026-02-01", points.map((p) => p.date));
  check("6. carry-forward totals", points.map((p) => p.totalCents).join(",") === "150000,150000,140000", points);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
