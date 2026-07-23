import { pgTable, text, timestamp, uuid, boolean, integer, pgEnum, unique, primaryKey } from "drizzle-orm/pg-core";
import { households } from "./household";
import { users } from "./auth";
import { accounts } from "./accounts";

// Kept small on purpose - a household growing this list (foster care, adult
// children who stay linked, etc.) should still fit "adult" or "child". Add
// values with a plain ALTER TYPE ... ADD VALUE migration if that ever stops
// being true.
export const personTypeEnum = pgEnum("person_type", ["adult", "child"]);

// A person is "who this money belongs to or came from" - distinct from a
// login `user`. Every household starts with zero persons; nothing infers
// them automatically. userId links an adult Person to their login when they
// have one (set null on user deletion - financial history must outlive a
// login). Persons are never hard-deleted (see isActive) since income/account
// history references them.
export const persons = pgTable(
  "person",
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    name: text().notNull(),
    personType: personTypeEnum().notNull().default("adult"),
    // One of the --chart-N theme tokens (e.g. "chart-1"), not a raw hex, so
    // swatches stay theme-aware in light/dark. Null falls back to an
    // index-based default wherever a person is rendered.
    color: text(),
    sortOrder: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [unique().on(t.householdId, t.name)],
);

// Join table for account ownership: 0 rows = unassigned/shared, 1 = individual,
// 2+ = joint. Deliberately not a column on `accounts` so joint ownership
// doesn't need a second shape later.
export const accountOwners = pgTable(
  "account_owner",
  {
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.personId] })],
);
