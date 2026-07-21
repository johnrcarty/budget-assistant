import { pgTable, text, timestamp, uuid, primaryKey } from "drizzle-orm/pg-core";
import { users } from "./auth";

// Everything budget-related hangs off householdId, not userId. That's what
// lets a single shared login work today and per-user OIDC identities
// (Authentik) slot in later without restructuring budget data.
export const households = pgTable("household", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
});

export const householdMembers = pgTable(
  "household_member",
  {
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text().notNull().default("member"),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.userId] })],
);
