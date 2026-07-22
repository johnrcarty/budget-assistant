import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  annualIncomeEntries,
  incomeForecasts,
  incomeForecastPoints,
} from "@/server/db/schema";

export type AnnualIncomeEntry = typeof annualIncomeEntries.$inferSelect;
export type IncomeForecast = typeof incomeForecasts.$inferSelect;

export interface AnnualIncomeData {
  entries: AnnualIncomeEntry[];
  persons: string[]; // ordered by first appearance year, then name
  years: number[]; // ascending, only years with data
  // person -> year -> gross cents
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
  const [entries, forecasts] = await Promise.all([
    db
      .select()
      .from(annualIncomeEntries)
      .where(eq(annualIncomeEntries.householdId, householdId))
      .orderBy(
        asc(annualIncomeEntries.year),
        asc(annualIncomeEntries.person),
        asc(annualIncomeEntries.createdAt),
      ),
    db
      .select()
      .from(incomeForecasts)
      .where(eq(incomeForecasts.householdId, householdId))
      .orderBy(desc(incomeForecasts.createdAt)),
  ]);

  const persons: string[] = [];
  const byPersonYear: Record<string, Record<number, number>> = {};
  const yearTotals: Record<number, { grossCents: number; withheldCents: number }> = {};
  const yearSet = new Set<number>();

  for (const entry of entries) {
    if (!persons.includes(entry.person)) persons.push(entry.person);
    yearSet.add(entry.year);
    byPersonYear[entry.person] ??= {};
    byPersonYear[entry.person][entry.year] =
      (byPersonYear[entry.person][entry.year] ?? 0) + entry.amountCents;
    yearTotals[entry.year] ??= { grossCents: 0, withheldCents: 0 };
    yearTotals[entry.year].grossCents += entry.amountCents;
    yearTotals[entry.year].withheldCents += entryWithheldCents(entry);
  }

  return {
    entries,
    persons,
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
    .orderBy(asc(incomeForecastPoints.year), asc(incomeForecastPoints.person));

  return { forecast, points };
}
