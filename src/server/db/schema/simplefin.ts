import {
  pgTable,
  text,
  timestamp,
  uuid,
  bigint,
  integer,
  jsonb,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { households } from "./household";
import { accounts } from "./accounts";

export const simplefinConnectionStatusEnum = pgEnum(
  "simplefin_connection_status",
  ["active", "error", "revoked"],
);

export const simplefinConnections = pgTable("simplefin_connection", {
  id: uuid().primaryKey().defaultRandom(),
  householdId: uuid()
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  // AES-256-GCM encrypted Access URL. Decrypted only inside the sync job
  // process, never sent to the client.
  accessUrlCiphertext: text().notNull(),
  accessUrlIv: text().notNull(),
  accessUrlAuthTag: text().notNull(),
  bridgeInfo: jsonb(),
  status: simplefinConnectionStatusEnum().notNull().default("active"),
  lastError: text(),
  createdAt: timestamp().notNull().defaultNow(),
});

export const simplefinConnectionAccounts = pgTable(
  "simplefin_connection_account",
  {
    id: uuid().primaryKey().defaultRandom(),
    connectionId: uuid()
      .notNull()
      .references(() => simplefinConnections.id, { onDelete: "cascade" }),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    simplefinAccountId: text().notNull(),
    // SimpleFin's display name for the account (e.g. "Chase Checking ...1234")
    // - refreshed on every sync, shown in the mapping UI so "which account is
    // this" is answerable without exposing the opaque simplefinAccountId.
    simplefinAccountName: text(),
    // Nullable until the user confirms the mapping in onboarding UI.
    accountId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    lastSyncedBalanceCents: bigint({ mode: "number" }),
    lastSyncedAt: timestamp(),
  },
  (t) => [unique().on(t.connectionId, t.simplefinAccountId)],
);

export const syncRunStatusEnum = pgEnum("sync_run_status", [
  "success",
  "partial",
  "error",
]);

export const syncRuns = pgTable("sync_run", {
  id: uuid().primaryKey().defaultRandom(),
  connectionId: uuid()
    .notNull()
    .references(() => simplefinConnections.id, { onDelete: "cascade" }),
  startedAt: timestamp().notNull().defaultNow(),
  finishedAt: timestamp(),
  status: syncRunStatusEnum().notNull().default("success"),
  accountsSynced: integer().notNull().default(0),
  transactionsImported: integer().notNull().default(0),
  errorDetail: text(),
});
