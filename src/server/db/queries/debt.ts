import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "@/server/db/client";
import { accounts, debtBalanceSnapshots, debtTermsVersions } from "@/server/db/schema";
import { simulateDebtPlan, type SimTerms } from "@/server/lib/debt-sim";
import { currentMonthString } from "@/lib/month";

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

export function toSimTerms(terms: typeof debtTermsVersions.$inferSelect): SimTerms {
  return {
    termsType: terms.termsType,
    aprBps: terms.aprBps,
    paymentFrequency: terms.paymentFrequency,
    minPaymentCents: terms.minPaymentCents,
    minPaymentIsPercent: terms.minPaymentIsPercent,
    minPaymentPercentBps: terms.minPaymentPercentBps,
    fixedPaymentCents: terms.fixedPaymentCents,
    payoffTargetDate: terms.payoffTargetDate,
    promoEndDate: terms.promoEndDate,
  };
}

// Thin wrapper over the shared payoff engine (server/lib/debt-sim.ts) so the
// per-account projection card and the /debt dashboard can never disagree.
// Amortizes from the latest known balance using the current effective terms -
// both may be stale/sparse; this always uses whatever is currently known.
export function projectPayoff(
  balanceCents: number,
  terms: typeof debtTermsVersions.$inferSelect,
): PayoffProjection {
  const result = simulateDebtPlan({
    debts: [
      {
        accountId: "self",
        name: "",
        balanceCents,
        originalBalanceCents: null,
        terms: toSimTerms(terms),
        budgetedMonthlyCents: null,
      },
    ],
    strategy: "snowball",
    extraMonthlyCents: 0,
    startMonth: currentMonthString(),
  });

  const debt = result.debts[0];
  switch (debt.status) {
    case "paid_off":
      return { monthsToPayoff: 0, payoffDate: null, totalInterestCents: 0 };
    case "needs_terms":
      return {
        monthsToPayoff: null,
        payoffDate: null,
        totalInterestCents: null,
        note:
          terms.termsType === "installment"
            ? "Set a fixed payment or payoff date to project payoff."
            : "Set a minimum payment to project payoff.",
      };
    case "negative_amortization":
      return {
        monthsToPayoff: null,
        payoffDate: null,
        totalInterestCents: null,
        note: "At this payment and rate, the balance won't go down - increase the payment.",
      };
    case "simulated":
      if (debt.payoffMonth === null) {
        return {
          monthsToPayoff: null,
          payoffDate: null,
          totalInterestCents: null,
          note: "Payoff is more than 50 years out at this payment.",
        };
      }
      return {
        monthsToPayoff: debt.monthsToPayoff,
        payoffDate: debt.payoffMonth,
        totalInterestCents: debt.totalInterestCents,
      };
  }
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
