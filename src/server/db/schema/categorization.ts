import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  bigint,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { households } from "./household";
import { accounts } from "./accounts";
import { lineItemTemplates, incomeTemplates } from "./budget";

export const ruleMatchTypeEnum = pgEnum("rule_match_type", [
  "contains",
  "starts_with",
  "exact",
]);

// Auto-categorization rules: when an uncategorized transaction's description
// matches the pattern (case-insensitive), it's linked to the target budget
// line item (via its recurring template) or income source. Exactly one of
// the two target columns is set. Rules run on SimpleFin sync, CSV import,
// and on demand from the categorize page; first match by priority wins.
export const categorizationRules = pgTable("categorization_rule", {
  id: uuid().primaryKey().defaultRandom(),
  householdId: uuid()
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  pattern: text().notNull(),
  matchType: ruleMatchTypeEnum().notNull().default("contains"),
  // Optional extra conditions ANDed with the pattern: same-employer
  // paychecks land in different accounts, so "same description, different
  // account" needs to route differently. Amount compares absolute values.
  accountId: uuid().references(() => accounts.id, { onDelete: "cascade" }),
  amountCents: bigint({ mode: "number" }),
  lineItemTemplateId: uuid().references(() => lineItemTemplates.id, {
    onDelete: "cascade",
  }),
  incomeTemplateId: uuid().references(() => incomeTemplates.id, {
    onDelete: "cascade",
  }),
  // Third target kind: mark matches as transfers between own accounts
  // (no template link). When set, both template columns are null.
  markAsTransfer: boolean().notNull().default(false),
  priority: integer().notNull().default(0),
  isActive: boolean().notNull().default(true),
  createdAt: timestamp().notNull().defaultNow(),
});
