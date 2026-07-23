import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  bigint,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import { households } from "./household";
import { persons } from "./person";

// Annual taxable income tracking (the "Income By Year" spreadsheet).
// Distinct from the budget's income_line_item tables, which plan monthly
// cash flow - these are yearly totals per person per source (W2, 1099, ...).
// Multiple rows per (person, year, source) are allowed - two W2 jobs in one
// year are two rows.
export const annualIncomeEntries = pgTable("annual_income_entry", {
  id: uuid().primaryKey().defaultRandom(),
  householdId: uuid()
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  // restrict, not cascade - persons are never hard-deleted in this app, but
  // this is a backstop against ever silently wiping tax history.
  personId: uuid()
    .notNull()
    .references(() => persons.id, { onDelete: "restrict" }),
  year: integer().notNull(),
  source: text().notNull(), // "w2", "1099", ... free text, suggestions in the UI
  amountCents: bigint({ mode: "number" }).notNull(),
  fedTaxCents: bigint({ mode: "number" }),
  stateTaxCents: bigint({ mode: "number" }),
  localTaxCents: bigint({ mode: "number" }),
  medicareCents: bigint({ mode: "number" }),
  socialSecurityCents: bigint({ mode: "number" }),
  note: text(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
});

// A saved projection. Points are MATERIALIZED at creation time and never
// recomputed - that's deliberate, so old projections stay exactly as they
// were made and can be compared against actuals as new years fill in.
export const incomeForecasts = pgTable("income_forecast", {
  id: uuid().primaryKey().defaultRandom(),
  householdId: uuid()
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  name: text().notNull(),
  model: text().notNull(), // key into FORECAST_MODELS (pattern, linear_regression, ...)
  params: jsonb().notNull().default({}),
  baseYear: integer().notNull(), // actuals at/before this year fed the model
  horizonYear: integer().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
});

export const incomeForecastPoints = pgTable(
  "income_forecast_point",
  {
    id: uuid().primaryKey().defaultRandom(),
    forecastId: uuid()
      .notNull()
      .references(() => incomeForecasts.id, { onDelete: "cascade" }),
    personId: uuid()
      .notNull()
      .references(() => persons.id, { onDelete: "restrict" }),
    year: integer().notNull(),
    amountCents: bigint({ mode: "number" }).notNull(),
  },
  (t) => [unique().on(t.forecastId, t.personId, t.year)],
);
