import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  bigint,
  date,
  boolean,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { households } from "./household";

export const balanceSourceEnum = pgEnum("balance_source", [
  "manual",
  "simplefin",
  "statement_import",
]);

// Sparse, append-only. "Latest known balance as of date X" is resolved by
// querying the most recent row with as_of_date <= X - see queries/debt.ts.
// There is no requirement for an unbroken monthly series.
export const debtBalanceSnapshots = pgTable(
  "debt_balance_snapshot",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    asOfDate: date().notNull(),
    // Always positive = amount owed.
    balanceCents: bigint({ mode: "number" }).notNull(),
    source: balanceSourceEnum().notNull().default("manual"),
    note: text(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [unique().on(t.accountId, t.asOfDate, t.source)],
);

export const debtTermsTypeEnum = pgEnum("debt_terms_type", [
  "revolving",
  "installment",
]);

// How often a payment is actually made. Payoff math converts everything to a
// monthly equivalent (biweekly = 26 payments/year, NOT 2/month - the extra
// two payments a year are real acceleration and must not be flattened).
export const paymentFrequencyEnum = pgEnum("payment_frequency", [
  "monthly",
  "semimonthly",
  "biweekly",
  "weekly",
]);

// Sparse, append-only, effective-dated. A version applies starting at
// effectiveDate until the next version's effectiveDate (derived, not stored -
// there is deliberately no endDate column). Add a row only when something
// actually changes (APR change, refinance, promo expiry, servicer transfer);
// old rows are never edited, which is what keeps this gap-tolerant and keeps
// a full audit trail for a future payoff burn-down chart.
export const debtTermsVersions = pgTable("debt_terms_version", {
  id: uuid().primaryKey().defaultRandom(),
  accountId: uuid()
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  effectiveDate: date().notNull(),
  termsType: debtTermsTypeEnum().notNull(),
  aprBps: integer(), // basis points, e.g. 2399 = 23.99% APR
  // Payment amounts below are per payment period, not per month.
  paymentFrequency: paymentFrequencyEnum().notNull().default("monthly"),
  minPaymentCents: bigint({ mode: "number" }),
  minPaymentIsPercent: boolean().notNull().default(false),
  minPaymentPercentBps: integer(),
  fixedPaymentCents: bigint({ mode: "number" }), // installment: fixed per-period payment
  // Portion of each payment that is escrow passthrough (taxes, insurance,
  // PMI) - real money out, but it never touches principal or interest, so
  // payoff math subtracts it from the payment.
  escrowCents: bigint({ mode: "number" }),
  payoffTargetDate: date(), // installment: known payoff/maturity date
  dueDay: integer(),
  servicerName: text(),
  promoEndDate: date(),
  note: text(),
  createdAt: timestamp().notNull().defaultNow(),
});

export const debtStrategyEnum = pgEnum("debt_strategy", ["snowball", "avalanche"]);

// Household-level payoff plan settings (one row per household - householdId
// as PK gives upsert-on-conflict for free). Shared between both users.
export const debtPlans = pgTable("debt_plan", {
  householdId: uuid()
    .primaryKey()
    .references(() => households.id, { onDelete: "cascade" }),
  strategy: debtStrategyEnum().notNull().default("snowball"),
  extraMonthlyCents: bigint({ mode: "number" }).notNull().default(0),
  updatedAt: timestamp().notNull().defaultNow(),
});
