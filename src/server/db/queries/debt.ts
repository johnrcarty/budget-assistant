import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "@/server/db/client";
import { accounts, debtBalanceSnapshots, debtTermsVersions } from "@/server/db/schema";

// Most recent terms version effective at or before `asOf` - gap-tolerant by
// construction: if nothing changed in 8 months, that row is still current.
export async function currentEffectiveTerms(accountId: string, asOf = new Date()) {
  const asOfDate = asOf.toISOString().slice(0, 10);

  const [terms] = await db
    .select()
    .from(debtTermsVersions)
    .where(
      and(
        eq(debtTermsVersions.accountId, accountId),
        lte(debtTermsVersions.effectiveDate, asOfDate),
      ),
    )
    .orderBy(desc(debtTermsVersions.effectiveDate), desc(debtTermsVersions.createdAt))
    .limit(1);

  return terms ?? null;
}

// Most recent balance snapshot at or before `asOf` - same gap-tolerant
// pattern as currentEffectiveTerms.
export async function latestKnownBalance(accountId: string, asOf = new Date()) {
  const asOfDate = asOf.toISOString().slice(0, 10);

  const [snapshot] = await db
    .select()
    .from(debtBalanceSnapshots)
    .where(
      and(
        eq(debtBalanceSnapshots.accountId, accountId),
        lte(debtBalanceSnapshots.asOfDate, asOfDate),
      ),
    )
    .orderBy(desc(debtBalanceSnapshots.asOfDate), desc(debtBalanceSnapshots.createdAt))
    .limit(1);

  return snapshot ?? null;
}

export interface PayoffProjection {
  monthsToPayoff: number | null;
  payoffDate: string | null;
  totalInterestCents: number | null;
  note?: string;
}

// Amortizes from the latest known balance using the current effective
// terms. Both are resolved independently and may be stale/sparse - this
// always uses whatever is currently known, never requires a complete
// history.
export function projectPayoff(
  balanceCents: number,
  terms: typeof debtTermsVersions.$inferSelect,
): PayoffProjection {
  if (terms.termsType === "installment") {
    if (terms.payoffTargetDate) {
      const months = monthsBetween(new Date(), new Date(terms.payoffTargetDate));
      return { monthsToPayoff: Math.max(months, 0), payoffDate: terms.payoffTargetDate, totalInterestCents: null };
    }
    if (terms.fixedPaymentCents && terms.fixedPaymentCents > 0) {
      const months = Math.ceil(balanceCents / terms.fixedPaymentCents);
      return {
        monthsToPayoff: months,
        payoffDate: addMonthsToDateString(new Date(), months),
        totalInterestCents: null,
      };
    }
    return { monthsToPayoff: null, payoffDate: null, totalInterestCents: null, note: "Set a fixed payment or payoff date to project payoff." };
  }

  // Revolving: standard minimum-payment amortization.
  const monthlyRate = (terms.aprBps ?? 0) / 10000 / 12;
  const minPaymentCents = resolveMinPaymentCents(balanceCents, terms);

  if (!minPaymentCents || minPaymentCents <= 0) {
    return { monthsToPayoff: null, payoffDate: null, totalInterestCents: null, note: "Set a minimum payment to project payoff." };
  }

  if (monthlyRate > 0 && minPaymentCents <= balanceCents * monthlyRate) {
    return {
      monthsToPayoff: null,
      payoffDate: null,
      totalInterestCents: null,
      note: "At this payment and rate, the balance won't go down - increase the payment.",
    };
  }

  let remaining = balanceCents;
  let months = 0;
  let totalInterest = 0;
  const MAX_MONTHS = 600; // 50 years - safety cap against pathological inputs

  while (remaining > 0 && months < MAX_MONTHS) {
    const interest = remaining * monthlyRate;
    totalInterest += interest;
    const payment = Math.min(minPaymentCents, remaining + interest);
    remaining = remaining + interest - payment;
    months += 1;
  }

  return {
    monthsToPayoff: months,
    payoffDate: addMonthsToDateString(new Date(), months),
    totalInterestCents: Math.round(totalInterest),
  };
}

function resolveMinPaymentCents(
  balanceCents: number,
  terms: typeof debtTermsVersions.$inferSelect,
): number | null {
  if (terms.minPaymentIsPercent && terms.minPaymentPercentBps) {
    const percentAmount = Math.round((balanceCents * terms.minPaymentPercentBps) / 10000);
    return terms.minPaymentCents
      ? Math.max(percentAmount, terms.minPaymentCents)
      : percentAmount;
  }
  return terms.minPaymentCents ?? null;
}

function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  );
}

function addMonthsToDateString(from: Date, months: number): string {
  const date = new Date(Date.UTC(from.getFullYear(), from.getMonth() + months, 1));
  return date.toISOString().slice(0, 10);
}

export async function getDebtAccounts(householdId: string) {
  const liabilityAccounts = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, householdId),
        eq(accounts.isLiability, true),
        eq(accounts.isArchived, false),
      ),
    );

  return Promise.all(
    liabilityAccounts.map(async (account) => ({
      account,
      latestBalance: await latestKnownBalance(account.id),
    })),
  );
}

export async function getDebtDetail(householdId: string, accountId: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.householdId, householdId),
        eq(accounts.isLiability, true),
      ),
    )
    .limit(1);
  if (!account) return null;

  const [terms, latestBalance, balanceHistory, termsHistory] = await Promise.all([
    currentEffectiveTerms(accountId),
    latestKnownBalance(accountId),
    db
      .select()
      .from(debtBalanceSnapshots)
      .where(eq(debtBalanceSnapshots.accountId, accountId))
      .orderBy(desc(debtBalanceSnapshots.asOfDate)),
    db
      .select()
      .from(debtTermsVersions)
      .where(eq(debtTermsVersions.accountId, accountId))
      .orderBy(desc(debtTermsVersions.effectiveDate)),
  ]);

  const projection = terms && latestBalance ? projectPayoff(latestBalance.balanceCents, terms) : null;

  return { account, terms, latestBalance, balanceHistory, termsHistory, projection };
}
