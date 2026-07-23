import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  boolean,
  date,
  bigint,
  unique,
} from "drizzle-orm/pg-core";
import { households } from "./household";
import { accounts } from "./accounts";
import { persons } from "./person";

export const categoryGroups = pgTable(
  "category_group",
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text().notNull(),
    icon: text(),
    sortOrder: integer().notNull().default(0),
    isArchived: boolean().notNull().default(false),
    // Set for app-managed groups (e.g. "debt" for the auto-created Debt
    // section that linked debt payments live in); null for user-created
    // groups. Identified by key, not name, so renames don't break it.
    // Postgres treats NULLs as distinct, so user groups are unaffected by
    // the unique constraint.
    systemKey: text(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [unique().on(t.householdId, t.systemKey)],
);

export const budgetMonths = pgTable(
  "budget_month",
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    // Always the 1st of the month; the day component is unused.
    month: date().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [unique().on(t.householdId, t.month)],
);

// The recurring "idea" of a line item. Budget items are stamped into a given
// month from the active templates; editing a template only affects future
// months, never past ones.
export const lineItemTemplates = pgTable(
  "line_item_template",
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    categoryGroupId: uuid()
      .notNull()
      .references(() => categoryGroups.id, { onDelete: "cascade" }),
    // Links this template to a liability account: the item's planned amount
    // is that debt's monthly payment, and the payoff dashboard reads it back
    // as the budgeted payment. At most one template per debt (unique below);
    // unlinking deactivates the template but keeps the link as its identity.
    debtAccountId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    name: text().notNull(),
    defaultPlannedAmountCents: bigint({ mode: "number" }).notNull().default(0),
    dueDay: integer(),
    recurrenceRule: text().notNull().default("monthly"),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [unique().on(t.debtAccountId)],
);

// The editable-per-month instance of a line item (mirrors EveryDollar: each
// month is its own re-plannable budget even though items recur).
export const budgetLineItems = pgTable("budget_line_item", {
  id: uuid().primaryKey().defaultRandom(),
  householdId: uuid()
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  budgetMonthId: uuid()
    .notNull()
    .references(() => budgetMonths.id, { onDelete: "cascade" }),
  categoryGroupId: uuid()
    .notNull()
    .references(() => categoryGroups.id, { onDelete: "cascade" }),
  templateItemId: uuid().references(() => lineItemTemplates.id, {
    onDelete: "set null",
  }),
  name: text().notNull(),
  plannedAmountCents: bigint({ mode: "number" }).notNull().default(0),
  dueDay: integer(),
  recurrenceRule: text().notNull().default("monthly"),
  isFavorite: boolean().notNull().default(false),
  note: text(),
  fundTargetCents: bigint({ mode: "number" }),
  fundBalanceCents: bigint({ mode: "number" }),
  sortOrder: integer().notNull().default(0),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
});

export const incomeTemplates = pgTable(
  "income_template",
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    // Null for templates that aren't tied to a person (bonuses, interest,
    // tax returns, ...) - stays nullable forever, unlike incomeSchedules.
    // restrict, not cascade - persons are never hard-deleted in this app.
    personId: uuid().references(() => persons.id, { onDelete: "restrict" }),
    // Which paycheck slot this is within its person. Meaningless (default 1)
    // for personId=null rows.
    slotNumber: integer().notNull().default(1),
    name: text().notNull(),
    defaultAmountCents: bigint({ mode: "number" }).notNull().default(0),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp().notNull().defaultNow(),
  },
  // Postgres treats every NULL personId as distinct, so multiple personless
  // singleton templates (slotNumber always 1) never collide here.
  (t) => [unique().on(t.personId, t.slotNumber)],
);

export const incomeLineItems = pgTable("income_line_item", {
  id: uuid().primaryKey().defaultRandom(),
  householdId: uuid()
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  budgetMonthId: uuid()
    .notNull()
    .references(() => budgetMonths.id, { onDelete: "cascade" }),
  templateItemId: uuid().references(() => incomeTemplates.id, {
    onDelete: "set null",
  }),
  name: text().notNull(),
  plannedAmountCents: bigint({ mode: "number" }).notNull().default(0),
  // Expected deposit date, stamped from the group's pay schedule. Display
  // metadata only - slot filling still assigns deposits in posted order.
  expectedDate: date(),
  sortOrder: integer().notNull().default(0),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
});

// Pay schedule per person.
export const incomeSchedules = pgTable(
  "income_schedule",
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid()
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    // restrict, not cascade - persons are never hard-deleted in this app.
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    // 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'irregular'
    frequency: text().notNull(),
    // One known check date anchoring the series; null only for 'irregular'.
    anchorDate: date(),
    // Semimonthly only: the second pay day of the month (the first comes
    // from anchorDate's day-of-month).
    secondDayOfMonth: integer(),
    perCheckAmountCents: bigint({ mode: "number" }).notNull().default(0),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [unique().on(t.householdId, t.personId)],
);
