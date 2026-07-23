import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  annualIncomeEntries,
  incomeForecasts,
  incomeForecastPoints,
  persons,
} from "@/server/db/schema";

export type AnnualIncomeEntry = typeof annualIncomeEntries.$inferSelect;
export type IncomeForecast = typeof incomeForecasts.$inferSelect;

export interface IncomePersonSummary {
  id: string;
  name: string;
  color: string | null;
}

export interface AnnualIncomeData {
  entries: AnnualIncomeEntry[];
  // Every person referenced by an entry OR a forecast point in this
  // household - including archived ones, since income history is append-only
  // historical fact and shouldn't vanish from the chart just because a
  // person was archived later.
  persons: IncomePersonSummary[];
  years: number[]; // ascending, only years with data
  // personId -> year -> gross cents
  byPersonYear: Record<string, Record<number, number>>;
  // year -> totals across persons
  yearTotals: Record<number, { grossCents: number; withheldCents: number }>;
  forecasts: IncomeForecast[]; // newest first
}

export function entryWithheldCents(entry: AnnualIncomeEntry): number {
  return (
    (entry.fedTaxCents ?? 0) +
    (entry.stateTaxCents ?? 0) +
    (entry.localTaxCents ?? 0) +
    (entry.medicareCents ?? 0) +
    (entry.socialSecurityCents ?? 0)
  );
}

export async function getAnnualIncomeData(householdId: string): Promise<AnnualIncomeData> {
  const [entries, forecasts, forecastPersonIdRows] = await Promise.all([
    db
      .select()
      .from(annualIncomeEntries)
      .where(eq(annualIncomeEntries.householdId, householdId))
      .orderBy(asc(annualIncomeEntries.year), asc(annualIncomeEntries.createdAt)),
    db
      .select()
      .from(incomeForecasts)
      .where(eq(incomeForecasts.householdId, householdId))
      .orderBy(desc(incomeForecasts.createdAt)),
    db
      .selectDistinct({ personId: incomeForecastPoints.personId })
      .from(incomeForecastPoints)
      .innerJoin(incomeForecasts, eq(incomeForecastPoints.forecastId, incomeForecasts.id))
      .where(eq(incomeForecasts.householdId, householdId)),
  ]);

  const byPersonYear: Record<string, Record<number, number>> = {};
  const yearTotals: Record<number, { grossCents: number; withheldCents: number }> = {};
  const yearSet = new Set<number>();
  const referencedPersonIds = new Set(forecastPersonIdRows.map((r) => r.personId));

  for (const entry of entries) {
    referencedPersonIds.add(entry.personId);
    yearSet.add(entry.year);
    byPersonYear[entry.personId] ??= {};
    byPersonYear[entry.personId][entry.year] =
      (byPersonYear[entry.personId][entry.year] ?? 0) + entry.amountCents;
    yearTotals[entry.year] ??= { grossCents: 0, withheldCents: 0 };
    yearTotals[entry.year].grossCents += entry.amountCents;
    yearTotals[entry.year].withheldCents += entryWithheldCents(entry);
  }

  const personRows =
    referencedPersonIds.size > 0
      ? await db
          .select({ id: persons.id, name: persons.name, color: persons.color, sortOrder: persons.sortOrder })
          .from(persons)
          .where(inArray(persons.id, [...referencedPersonIds]))
      : [];
  const personsList: IncomePersonSummary[] = personRows
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map(({ id, name, color }) => ({ id, name, color }));

  return {
    entries,
    persons: personsList,
    years: [...yearSet].sort((a, b) => a - b),
    byPersonYear,
    yearTotals,
    forecasts,
  };
}

export async function getForecastPoints(householdId: string, forecastId: string) {
  const [forecast] = await db
    .select()
    .from(incomeForecasts)
    .where(
      and(eq(incomeForecasts.id, forecastId), eq(incomeForecasts.householdId, householdId)),
    )
    .limit(1);
  if (!forecast) return null;

  const points = await db
    .select()
    .from(incomeForecastPoints)
    .where(eq(incomeForecastPoints.forecastId, forecastId))
    .orderBy(asc(incomeForecastPoints.year), asc(incomeForecastPoints.personId));

  return { forecast, points };
}
