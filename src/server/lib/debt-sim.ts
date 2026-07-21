import { shiftMonthString } from "@/lib/month";

// Pure debt payoff math - no db, no React, no server-only - so it's shared
// by the dashboard queries, the per-account projection card, and tsx
// verification scripts.
//
// Model notes:
// - Simulation runs on a monthly grid. Per-period payments are converted to
//   a monthly equivalent (biweekly $100 -> $216.67/mo, i.e. 26 payments/yr,
//   NOT 2/mo - the extra two payments a year are real acceleration). What
//   this approximates away is only intra-month payment timing, which is
//   second-order and consistent with the monthly interest compounding used
//   throughout.
// - Balances accrue in float cents internally; rounding happens once at
//   reporting time.

export type PaymentFrequency = "monthly" | "semimonthly" | "biweekly" | "weekly";

export const PERIODS_PER_YEAR: Record<PaymentFrequency, number> = {
  monthly: 12,
  semimonthly: 24,
  biweekly: 26,
  weekly: 52,
};

export function monthlyEquivalentCents(
  perPeriodCents: number,
  frequency: PaymentFrequency,
): number {
  return Math.round((perPeriodCents * PERIODS_PER_YEAR[frequency]) / 12);
}

export interface SimTerms {
  termsType: "revolving" | "installment";
  aprBps: number | null;
  paymentFrequency: PaymentFrequency;
  minPaymentCents: number | null;
  minPaymentIsPercent: boolean;
  minPaymentPercentBps: number | null;
  fixedPaymentCents: number | null;
  payoffTargetDate: string | null;
  promoEndDate: string | null;
}

export interface SimDebtInput {
  accountId: string;
  name: string;
  balanceCents: number; // positive = owed
  originalBalanceCents: number | null;
  terms: SimTerms | null;
  budgetedMonthlyCents: number | null; // from a linked budget item (already monthly)
}

export type SimDebtStatus =
  | "simulated"
  | "paid_off"
  | "needs_terms"
  | "negative_amortization";

export interface SimulatedDebt {
  accountId: string;
  name: string;
  status: SimDebtStatus;
  startingBalanceCents: number;
  payoffMonth: string | null; // YYYY-MM-01
  monthsToPayoff: number | null;
  totalInterestCents: number | null;
  baseMonthlyCents: number; // starting base payment; 0 when excluded
}

export type SimWarningKind =
  | "negative_amortization"
  | "needs_terms"
  | "budget_below_minimum"
  | "promo_ends"
  | "capped";

export interface SimWarning {
  accountId: string;
  kind: SimWarningKind;
}

export interface TimelinePoint {
  month: string; // YYYY-MM-01
  totalCents: number;
  perDebtCents: Record<string, number>;
}

export interface DebtPlanResult {
  debts: SimulatedDebt[]; // strategy order, then excluded/paid-off
  order: string[]; // accountIds of simulated debts, strategy order
  timeline: TimelinePoint[]; // month 0 = startMonth with starting balances
  debtFreeMonth: string | null;
  totalInterestCents: number;
  monthlyCommitmentCents: number; // sum of starting base payments + extra
  baseline: { debtFreeMonth: string | null; totalInterestCents: number | null };
  interestSavedCents: number | null;
  monthsSooner: number | null;
  warnings: SimWarning[];
}

export const MAX_MONTHS = 600; // 50 years - safety cap

// The minimum payment a servicer would require this month, in per-period
// cents. Percent-of-balance minimums are recomputed on the current balance
// with the dollar amount as a floor.
export function resolveMinPaymentCents(
  balanceCents: number,
  terms: Pick<SimTerms, "minPaymentCents" | "minPaymentIsPercent" | "minPaymentPercentBps">,
): number | null {
  if (terms.minPaymentIsPercent && terms.minPaymentPercentBps) {
    const percentAmount = Math.round((balanceCents * terms.minPaymentPercentBps) / 10000);
    return terms.minPaymentCents
      ? Math.max(percentAmount, terms.minPaymentCents)
      : percentAmount;
  }
  return terms.minPaymentCents ?? null;
}

function monthlyRate(terms: SimTerms): number {
  return (terms.aprBps ?? 0) / 10000 / 12;
}

function monthsBetweenMonths(fromMonth: string, toDate: string): number {
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toDate.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// Fixed monthly payment implied by "pay balance B off in n months at rate r"
// (standard annuity formula; linear when r = 0).
function impliedMonthlyPaymentCents(balanceCents: number, rate: number, months: number): number {
  const n = Math.max(1, months);
  if (rate <= 0) return Math.ceil(balanceCents / n);
  return Math.ceil((balanceCents * rate) / (1 - Math.pow(1 + rate, -n)));
}

// This month's required monthly-equivalent payment for a debt. Returns null
// when the terms don't define one (needs_terms).
function requiredMonthlyCents(
  balanceCents: number,
  terms: SimTerms,
  impliedInstallmentCents: number | null,
): number | null {
  if (terms.termsType === "installment") {
    if (terms.fixedPaymentCents && terms.fixedPaymentCents > 0) {
      return monthlyEquivalentCents(terms.fixedPaymentCents, terms.paymentFrequency);
    }
    return impliedInstallmentCents; // derived from payoffTargetDate, or null
  }
  const min = resolveMinPaymentCents(balanceCents, terms);
  if (!min || min <= 0) return null;
  return monthlyEquivalentCents(min, terms.paymentFrequency);
}

// Required payment for the *current* month, used both by the simulator and
// by the budget-link action to seed a planned amount.
export function currentRequiredMonthlyCents(
  balanceCents: number,
  terms: SimTerms,
  startMonth: string,
): number | null {
  return requiredMonthlyCents(balanceCents, terms, impliedForTerms(balanceCents, terms, startMonth));
}

function impliedForTerms(
  balanceCents: number,
  terms: SimTerms,
  startMonth: string,
): number | null {
  if (
    terms.termsType === "installment" &&
    (!terms.fixedPaymentCents || terms.fixedPaymentCents <= 0) &&
    terms.payoffTargetDate
  ) {
    const months = monthsBetweenMonths(startMonth, terms.payoffTargetDate);
    return impliedMonthlyPaymentCents(balanceCents, monthlyRate(terms), months);
  }
  return null;
}

interface LiveDebt {
  input: SimDebtInput;
  terms: SimTerms;
  balance: number; // float cents
  impliedInstallmentCents: number | null;
  startingBaseCents: number;
  currentBaseCents: number; // base payment computed in the current sim month
  totalInterest: number;
  payoffMonthIndex: number | null;
}

export function simulateDebtPlan(input: {
  debts: SimDebtInput[];
  strategy: "snowball" | "avalanche";
  extraMonthlyCents: number;
  startMonth: string; // YYYY-MM-01
}): DebtPlanResult {
  const { strategy, extraMonthlyCents, startMonth } = input;
  const warnings: SimWarning[] = [];
  const excluded: SimulatedDebt[] = [];
  const live: LiveDebt[] = [];

  for (const debt of input.debts) {
    if (debt.balanceCents <= 0) {
      excluded.push({
        accountId: debt.accountId,
        name: debt.name,
        status: "paid_off",
        startingBalanceCents: 0,
        payoffMonth: null,
        monthsToPayoff: null,
        totalInterestCents: null,
        baseMonthlyCents: 0,
      });
      continue;
    }

    const implied = debt.terms ? impliedForTerms(debt.balanceCents, debt.terms, startMonth) : null;
    const required = debt.terms
      ? requiredMonthlyCents(debt.balanceCents, debt.terms, implied)
      : null;

    if (!debt.terms || required === null) {
      warnings.push({ accountId: debt.accountId, kind: "needs_terms" });
      excluded.push({
        accountId: debt.accountId,
        name: debt.name,
        status: "needs_terms",
        startingBalanceCents: debt.balanceCents,
        payoffMonth: null,
        monthsToPayoff: null,
        totalInterestCents: null,
        baseMonthlyCents: 0,
      });
      continue;
    }

    const base = Math.max(debt.budgetedMonthlyCents ?? 0, required);
    if (debt.budgetedMonthlyCents !== null && debt.budgetedMonthlyCents < required) {
      warnings.push({ accountId: debt.accountId, kind: "budget_below_minimum" });
    }

    // A debt whose own payment can't outrun its interest never amortizes on
    // its own - flag it and keep it out of the plan rather than pretending.
    const rate = monthlyRate(debt.terms);
    if (rate > 0 && base <= debt.balanceCents * rate) {
      warnings.push({ accountId: debt.accountId, kind: "negative_amortization" });
      excluded.push({
        accountId: debt.accountId,
        name: debt.name,
        status: "negative_amortization",
        startingBalanceCents: debt.balanceCents,
        payoffMonth: null,
        monthsToPayoff: null,
        totalInterestCents: null,
        baseMonthlyCents: base,
      });
      continue;
    }

    if (debt.terms.promoEndDate && debt.terms.promoEndDate > startMonth) {
      warnings.push({ accountId: debt.accountId, kind: "promo_ends" });
    }

    live.push({
      input: debt,
      terms: debt.terms,
      balance: debt.balanceCents,
      impliedInstallmentCents: implied,
      startingBaseCents: base,
      currentBaseCents: base,
      totalInterest: 0,
      payoffMonthIndex: null,
    });
  }

  // Strategy order, fixed at start for determinism: snowball = smallest
  // balance first; avalanche = highest APR first (null APR last), ties to
  // the smaller balance.
  live.sort((a, b) => {
    if (strategy === "snowball") {
      return a.balance - b.balance || (b.terms.aprBps ?? 0) - (a.terms.aprBps ?? 0);
    }
    return (b.terms.aprBps ?? -1) - (a.terms.aprBps ?? -1) || a.balance - b.balance;
  });
  const order = live.map((d) => d.input.accountId);

  const timeline: TimelinePoint[] = [snapshotPoint(startMonth, live)];
  let freedMonthlyCents = 0;
  let month = 0;
  let capped = false;

  while (live.some((d) => d.balance > 0) && month < MAX_MONTHS) {
    month += 1;
    let pool = extraMonthlyCents + freedMonthlyCents;

    // Every live debt accrues interest and pays its own base payment;
    // whatever a nearly-dead debt doesn't need joins this month's pool.
    for (const debt of live) {
      if (debt.balance <= 0) continue;
      const interest = debt.balance * monthlyRate(debt.terms);
      debt.totalInterest += interest;
      debt.balance += interest;

      const base = Math.max(
        debt.input.budgetedMonthlyCents ?? 0,
        requiredMonthlyCents(debt.balance, debt.terms, debt.impliedInstallmentCents) ?? 0,
      );
      debt.currentBaseCents = base;
      const payment = Math.min(base, debt.balance);
      debt.balance -= payment;
      pool += base - payment;

      if (debt.balance <= 0.5) {
        debt.balance = 0;
        debt.payoffMonthIndex = month;
        // From next month on, this debt's payment rolls into the pool.
        freedMonthlyCents += base;
      }
    }

    // Pool cascades through live debts in strategy order (true rollover:
    // if the target dies mid-month, the remainder attacks the next one).
    for (const debt of live) {
      if (pool <= 0) break;
      if (debt.balance <= 0) continue;
      const applied = Math.min(pool, debt.balance);
      debt.balance -= applied;
      pool -= applied;
      if (debt.balance <= 0.5) {
        debt.balance = 0;
        debt.payoffMonthIndex = month;
        freedMonthlyCents += debt.currentBaseCents;
      }
    }

    timeline.push(snapshotPoint(shiftMonthString(startMonth, month), live));
  }

  if (live.some((d) => d.balance > 0)) {
    capped = true;
    for (const debt of live) {
      if (debt.balance > 0) warnings.push({ accountId: debt.input.accountId, kind: "capped" });
    }
  }

  const planMonths = capped
    ? null
    : live.reduce((max, d) => Math.max(max, d.payoffMonthIndex ?? 0), 0);

  // Baseline: every debt pays only its own required minimum - no extra, no
  // rollover, no budgeted top-ups. The honest "do nothing" comparison.
  const baseline = simulateBaseline(live, startMonth);

  const simulated: SimulatedDebt[] = live.map((d) => ({
    accountId: d.input.accountId,
    name: d.input.name,
    status: "simulated",
    startingBalanceCents: d.input.balanceCents,
    payoffMonth:
      d.payoffMonthIndex !== null ? shiftMonthString(startMonth, d.payoffMonthIndex) : null,
    monthsToPayoff: d.payoffMonthIndex,
    totalInterestCents: Math.round(d.totalInterest),
    baseMonthlyCents: d.startingBaseCents,
  }));

  const totalInterestCents = Math.round(live.reduce((sum, d) => sum + d.totalInterest, 0));

  return {
    debts: [...simulated, ...excluded],
    order,
    timeline,
    debtFreeMonth: planMonths !== null && live.length > 0
      ? shiftMonthString(startMonth, planMonths)
      : null,
    totalInterestCents,
    monthlyCommitmentCents:
      live.reduce((sum, d) => sum + d.startingBaseCents, 0) + extraMonthlyCents,
    baseline,
    interestSavedCents:
      baseline.totalInterestCents !== null
        ? Math.max(0, baseline.totalInterestCents - totalInterestCents)
        : null,
    monthsSooner:
      baseline.debtFreeMonth !== null && planMonths !== null
        ? Math.max(0, monthsBetweenMonths(startMonth, baseline.debtFreeMonth) - planMonths)
        : null,
    warnings,
  };
}

function snapshotPoint(month: string, live: LiveDebt[]): TimelinePoint {
  const perDebtCents: Record<string, number> = {};
  let total = 0;
  for (const debt of live) {
    const cents = Math.round(debt.balance);
    perDebtCents[debt.input.accountId] = cents;
    total += cents;
  }
  return { month, totalCents: total, perDebtCents };
}

function simulateBaseline(
  live: LiveDebt[],
  startMonth: string,
): { debtFreeMonth: string | null; totalInterestCents: number | null } {
  let maxMonths = 0;
  let totalInterest = 0;

  for (const debt of live) {
    let balance = debt.input.balanceCents;
    const rate = monthlyRate(debt.terms);
    let months = 0;

    while (balance > 0.5 && months < MAX_MONTHS) {
      const interest = balance * rate;
      totalInterest += interest;
      balance += interest;
      const required =
        requiredMonthlyCents(balance, debt.terms, debt.impliedInstallmentCents) ?? 0;
      if (required <= 0 || (rate > 0 && required <= balance * rate && months === 0)) {
        months = MAX_MONTHS;
        break;
      }
      balance -= Math.min(required, balance);
      months += 1;
    }

    if (months >= MAX_MONTHS) return { debtFreeMonth: null, totalInterestCents: null };
    maxMonths = Math.max(maxMonths, months);
  }

  if (live.length === 0) return { debtFreeMonth: null, totalInterestCents: null };
  return {
    debtFreeMonth: shiftMonthString(startMonth, maxMonths),
    totalInterestCents: Math.round(totalInterest),
  };
}

// ---- Portfolio balance history (for the burn-down chart) ----

export interface HistoryPoint {
  date: string; // YYYY-MM-DD
  totalCents: number;
  perDebtCents: Record<string, number>;
}

// Carry-forward semantics mirror latestKnownBalance: at each sample date,
// each account contributes its most recent snapshot at-or-before that date.
// The series starts at the LAST of the per-account first-snapshot dates -
// before that the portfolio total is undefined and would falsely dip.
export function buildPortfolioHistory(
  snapshotsByAccount: Map<string, { asOfDate: string; balanceCents: number }[]>, // asc by date
  sampleDates: string[], // asc, YYYY-MM-DD
): HistoryPoint[] {
  const accounts = [...snapshotsByAccount.entries()].filter(([, snaps]) => snaps.length > 0);
  if (accounts.length === 0) return [];

  const seriesStart = accounts
    .map(([, snaps]) => snaps[0].asOfDate)
    .reduce((max, d) => (d > max ? d : max));

  const points: HistoryPoint[] = [];
  for (const date of sampleDates) {
    if (date < seriesStart) continue;
    const perDebtCents: Record<string, number> = {};
    let total = 0;
    for (const [accountId, snaps] of accounts) {
      let balance = 0;
      for (const snap of snaps) {
        if (snap.asOfDate > date) break;
        balance = snap.balanceCents;
      }
      perDebtCents[accountId] = balance;
      total += balance;
    }
    points.push({ date, totalCents: total, perDebtCents });
  }
  return points;
}
