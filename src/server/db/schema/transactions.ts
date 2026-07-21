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
