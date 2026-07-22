import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  bigint,
  integer,
  pgEnum,
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { households } from "./household";

// Display-level rollup of accounts (e.g. "Student Loans" holding several
// individual loan accounts). Grouping changes ONLY how the accounts page
// renders - members stay ordinary accounts everywhere else (debt payoff,
// trends, budget links all operate per account). Unique name per household
// gives get-or-create for the inline "New group…" flow.
export const accountGroups = pgTable(
  "account_group",
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text().notNull(),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [unique().on(t.householdId, t.name)],
);

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
  // Physical assets tracked at an appraised/estimated value, updated
  // manually - never SimpleFin-synced. Kept at the END of the enum so
  // additions stay plain ALTER TYPE ... ADD VALUE migrations.
  "property",
  "vehicle",
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
  // Set only on liabilities: the asset account (house, car) this debt is
  // secured by. Deliberately NOT unique - multiple loans can share one
  // asset (mortgage + HELOC on the same house). Equity for an asset is its
  // value minus the sum of all liabilities pointing at it.
  securedAssetAccountId: uuid().references((): AnyPgColumn => accounts.id, {
    onDelete: "set null",
  }),
  // Optional membership in a display rollup; deleting the group just
  // ungroups the members (set null), never touches the accounts.
  accountGroupId: uuid().references(() => accountGroups.id, { onDelete: "set null" }),
  isManual: boolean().notNull().default(true),
  isArchived: boolean().notNull().default(false),
  icon: text(),
  color: text(),
  createdAt: timestamp().notNull().defaultNow(),
});
