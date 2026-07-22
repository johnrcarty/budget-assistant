import { pgTable, timestamp, uuid, bigint, date, unique } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { balanceSourceEnum } from "./debt";

// Sparse, append-only balance history for EVERY account, asset or liability -
// the general-purpose sibling of debtBalanceSnapshots. It exists because
// accounts without transactions (401ks, savings) have no other way to grow a
// trend line: the sync job upserts a row per account per sync day. Same
// sign convention as accounts.currentBalanceCents: liabilities are stored
// positive (amount owed). "Balance as of date X" resolves as the most recent
// row at-or-before X; no unbroken daily series is required.
export const accountBalanceSnapshots = pgTable(
  "account_balance_snapshot",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    asOfDate: date().notNull(),
    balanceCents: bigint({ mode: "number" }).notNull(),
    source: balanceSourceEnum().notNull().default("simplefin"),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [unique().on(t.accountId, t.asOfDate, t.source)],
);
