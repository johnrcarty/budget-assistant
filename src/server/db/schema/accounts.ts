import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  bigint,
  pgEnum,
} from "drizzle-orm/pg-core";
import { households } from "./household";

// investment/crypto are reserved now and unused until that phase is built -
// future holdings tables will key off accounts.id without touching this table.
export const accountKindEnum = pgEnum("account_kind", [
  "checking",
  "savings",
  "credit_card",
  "loan",
  "line_of_credit",
  "cash",
  "other",
  "investment",
  "crypto",
]);

export const accounts = pgTable("account", {
  id: uuid().primaryKey().defaultRandom(),
  householdId: uuid()
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  name: text().notNull(),
  kind: accountKindEnum().notNull(),
  // Freeform, e.g. 'student_loan', 'bnpl', 'medical' - not an enum since real
  // debts don't fit a fixed taxonomy and this is display/grouping only.
  subtype: text(),
  isLiability: boolean().notNull().default(false),
  currency: text().notNull().default("USD"),
  // Denormalized cache for fast dashboard reads; source of truth for debts is
  // debtBalanceSnapshots.
  currentBalanceCents: bigint({ mode: "number" }),
  balanceAsOf: timestamp(),
  // A fixed reference point ("balance when this debt started"), not a
  // snapshot - unlike debtBalanceSnapshots this never changes on its own, so
  // it doesn't belong in that time-series. Powers "$X paid off so far".
  originalBalanceCents: bigint({ mode: "number" }),
  isManual: boolean().notNull().default(true),
  isArchived: boolean().notNull().default(false),
  icon: text(),
  color: text(),
  createdAt: timestamp().notNull().defaultNow(),
});
