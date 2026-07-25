import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  bigint,
  date,
  jsonb,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { households } from "./household";
import { accounts } from "./accounts";
import { budgetLineItems, incomeLineItems } from "./budget";

export const transactionSourceEnum = pgEnum("transaction_source", [
  "manual",
  "simplefin",
  "csv_import",
]);

export const transactions = pgTable(
  "transaction",
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // Signed: negative = outflow, positive = inflow.
    amountCents: bigint({ mode: "number" }).notNull(),
    description: text().notNull(),
    merchant: text(),
    postedDate: date().notNull(),
    pending: boolean().notNull().default(false),
    budgetLineItemId: uuid().references(() => budgetLineItems.id, {
      onDelete: "set null",
    }),
    incomeLineItemId: uuid().references(() => incomeLineItems.id, {
      onDelete: "set null",
    }),
    // Money moved between the household's own accounts (credit card
    // payments, checking->savings). Excluded from cash flow income and
    // spending; mutually exclusive with the two link columns (app-enforced:
    // marking as transfer nulls the links and vice versa).
    isTransfer: boolean().notNull().default(false),
    source: transactionSourceEnum().notNull().default("manual"),
    // SimpleFin's per-account transaction id. Null for manual rows - Postgres
    // treats NULLs as distinct, so manual entries never collide with synced ones.
    externalId: text(),
    simplefinAccountRef: text(),
    rawPayload: jsonb(),
    note: text(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [unique().on(t.accountId, t.source, t.externalId)],
);

// Tombstones for deleted synced transactions. Deleting a row with an
// externalId records its feed identity here, and both importers (SimpleFin
// sync, CSV import) skip anything recorded for the account - otherwise the
// next sync's upsert would just re-create what the user deleted, since the
// feed keeps returning it for as long as it stays inside the lookback
// window. Manual entries (externalId null) have no feed identity, can never
// be re-imported, and so are never recorded here. The description/amount/
// date snapshot exists so an excluded transaction stays identifiable after
// the original row is gone.
export const transactionExclusions = pgTable(
  "transaction_exclusion",
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    source: transactionSourceEnum().notNull(),
    externalId: text().notNull(),
    description: text().notNull(),
    amountCents: bigint({ mode: "number" }).notNull(),
    postedDate: date().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [unique().on(t.accountId, t.source, t.externalId)],
);
