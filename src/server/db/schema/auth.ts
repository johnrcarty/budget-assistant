import { pgTable, text, timestamp, primaryKey, integer, uuid } from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

export const users = pgTable("user", {
  id: uuid().primaryKey().defaultRandom(),
  name: text(),
  email: text().notNull().unique(),
  emailVerified: timestamp({ mode: "date" }),
  image: text(),
  passwordHash: text(),
  createdAt: timestamp().notNull().defaultNow(),
});

// OAuth provider accounts (Auth.js's "account" concept - a linked login
// method, distinct from our financial `accounts` table). Unused while
// Credentials-only, but required by the Drizzle adapter shape and is exactly
// where an Authentik OIDC provider will write rows later without any schema
// change.
// Property names below match @auth/drizzle-adapter's expected shape exactly
// (it mixes camelCase and snake_case keys) - the `casing: "snake_case"`
// client option only affects columns whose JS key isn't already the literal
// name the adapter looks up.
export const oauthAccounts = pgTable(
  "oauth_account",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text().$type<AdapterAccountType>().notNull(),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    refresh_token: text(),
    access_token: text(),
    expires_at: integer(),
    token_type: text(),
    scope: text(),
    id_token: text(),
    session_state: text(),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
);

export const sessions = pgTable("session", {
  sessionToken: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp({ mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_token",
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);
