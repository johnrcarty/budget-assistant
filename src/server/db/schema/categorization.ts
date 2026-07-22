import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { households } from "./household";
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
  lineItemTemplateId: uuid().references(() => lineItemTemplates.id, {
    onDelete: "cascade",
  }),
  incomeTemplateId: uuid().references(() => incomeTemplates.id, {
    onDelete: "cascade",
  }),
  priority: integer().notNull().default(0),
  isActive: boolean().notNull().default(true),
  createdAt: timestamp().notNull().defaultNow(),
});
