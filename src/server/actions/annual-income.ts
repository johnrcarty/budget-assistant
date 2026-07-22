"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/server/db/client";
import {
  annualIncomeEntries,
  incomeForecasts,
  incomeForecastPoints,
} from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";
import { dollarsToCents } from "@/server/lib/money";
import {
  DEFAULT_PATTERN_RATES_BPS,
  FORECAST_MODELS,
  isForecastModel,
  parsePatternRates,
} from "@/server/lib/income-forecast";

const entrySchema = z.object({
  person: z.string().trim().min(1).max(60),
  year: z.coerce.number().int().min(1900).max(2200),
  source: z.string().trim().min(1).max(40),
  amount: z.string().trim().min(1),
  fedTax: z.string().trim().optional(),
  stateTax: z.string().trim().optional(),
  localTax: z.string().trim().optional(),
  medicare: z.string().trim().optional(),
  socialSecurity: z.string().trim().optional(),
  note: z.string().trim().max(2000).optional(),
});

function optionalCents(value: string | undefined): number | null {
  return value ? dollarsToCents(value) : null;
}

export async function saveIncomeEntry(entryId: string | null, formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = entrySchema.parse({
    person: formData.get("person"),
    year: formData.get("year"),
    source: formData.get("source"),
    amount: formData.get("amount"),
    fedTax: formData.get("fedTax") || undefined,
    stateTax: formData.get("stateTax") || undefined,
    localTax: formData.get("localTax") || undefined,
    medicare: formData.get("medicare") || undefined,
    socialSecurity: formData.get("socialSecurity") || undefined,
    note: formData.get("note") || undefined,
  });

  const values = {
    person: input.person,
    year: input.year,
    source: input.source.toLowerCase(),
    amountCents: dollarsToCents(input.amount),
    fedTaxCents: optionalCents(input.fedTax),
    stateTaxCents: optionalCents(input.stateTax),
    localTaxCents: optionalCents(input.localTax),
    medicareCents: optionalCents(input.medicare),
    socialSecurityCents: optionalCents(input.socialSecurity),
    note: input.note || null,
  };

  if (entryId) {
    await db
      .update(annualIncomeEntries)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(annualIncomeEntries.id, entryId),
          eq(annualIncomeEntries.householdId, householdId),
        ),
      );
  } else {
    await db.insert(annualIncomeEntries).values({ householdId, ...values });
  }

  revalidatePath("/income");
}

export async function deleteIncomeEntry(entryId: string) {
  const householdId = await getCurrentHousehold();
  await db
    .delete(annualIncomeEntries)
    .where(
      and(
        eq(annualIncomeEntries.id, entryId),
        eq(annualIncomeEntries.householdId, householdId),
      ),
    );
  revalidatePath("/income");
}

const forecastSchema = z.object({
  name: z.string().trim().min(1).max(80),
  model: z.string(),
  baseYear: z.coerce.number().int().min(1900).max(2200),
  horizonYear: z.coerce.number().int().min(1900).max(2300),
  patternRates: z.string().trim().optional(),
});

// Computes the projection from actuals at/before the base year and stores
// the resulting points permanently. Re-running later with more data creates
// a NEW forecast - existing ones are never touched, so projections made at
// different times stay comparable.
export async function createForecast(formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = forecastSchema.parse({
    name: formData.get("name"),
    model: formData.get("model"),
    baseYear: formData.get("baseYear"),
    horizonYear: formData.get("horizonYear"),
    patternRates: formData.get("patternRates") || undefined,
  });
  if (!isForecastModel(input.model)) throw new Error("Unknown forecast model");
  if (input.horizonYear <= input.baseYear) throw new Error("Horizon must be after base year");

  const params: Record<string, unknown> = {};
  if (input.model === "pattern") {
    params.ratesBps = input.patternRates
      ? (parsePatternRates(input.patternRates) ?? DEFAULT_PATTERN_RATES_BPS)
      : DEFAULT_PATTERN_RATES_BPS;
  }

  const entries = await db
    .select()
    .from(annualIncomeEntries)
    .where(eq(annualIncomeEntries.householdId, householdId));

  const byPerson = new Map<string, Map<number, number>>();
  for (const entry of entries) {
    if (entry.year > input.baseYear) continue;
    const years = byPerson.get(entry.person) ?? new Map<number, number>();
    years.set(entry.year, (years.get(entry.year) ?? 0) + entry.amountCents);
    byPerson.set(entry.person, years);
  }
  if (byPerson.size === 0) throw new Error("No actuals at or before the base year");

  const model = FORECAST_MODELS[input.model];
  const points: { person: string; year: number; amountCents: number }[] = [];
  for (const [person, actualsByYear] of byPerson) {
    for (const point of model.compute({
      actualsByYear,
      baseYear: input.baseYear,
      horizonYear: input.horizonYear,
      params,
    })) {
      points.push({ person, ...point });
    }
  }

  const [forecast] = await db
    .insert(incomeForecasts)
    .values({
      householdId,
      name: input.name,
      model: input.model,
      params,
      baseYear: input.baseYear,
      horizonYear: input.horizonYear,
    })
    .returning();

  if (points.length > 0) {
    await db
      .insert(incomeForecastPoints)
      .values(points.map((p) => ({ forecastId: forecast.id, ...p })));
  }

  revalidatePath("/income");
  redirect(`/income?forecast=${forecast.id}`);
}

const importRowSchema = z.object({
  person: z.string().trim().min(1).max(60),
  year: z.number().int().min(1900).max(2200),
  source: z.string().trim().min(1).max(40),
  amountCents: z.number().int().positive(),
  fedTaxCents: z.number().int().nonnegative().nullable(),
  stateTaxCents: z.number().int().nonnegative().nullable(),
  localTaxCents: z.number().int().nonnegative().nullable(),
  medicareCents: z.number().int().nonnegative().nullable(),
  socialSecurityCents: z.number().int().nonnegative().nullable(),
});

export interface IncomeImportResult {
  imported: number;
  skippedDuplicates: number;
}

// Content-based dedup, same trade-off as the transactions CSV import: a row
// exactly matching an existing entry's (person, year, source, amount) is
// treated as a re-import and skipped, which makes importing the same file
// twice safe. Two genuinely identical real entries would collide - add one
// of them manually in that rare case.
export async function importIncomeCsv(
  rows: z.infer<typeof importRowSchema>[],
): Promise<IncomeImportResult> {
  const householdId = await getCurrentHousehold();
  const input = z.array(importRowSchema).min(1).max(5000).parse(rows);

  const existing = await db
    .select()
    .from(annualIncomeEntries)
    .where(eq(annualIncomeEntries.householdId, householdId));
  const seen = new Set(
    existing.map(
      (e) => `${e.person.toLowerCase()}|${e.year}|${e.source}|${e.amountCents}`,
    ),
  );

  let imported = 0;
  await db.transaction(async (tx) => {
    for (const row of input) {
      const key = `${row.person.toLowerCase()}|${row.year}|${row.source.toLowerCase()}|${row.amountCents}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await tx.insert(annualIncomeEntries).values({
        householdId,
        person: row.person,
        year: row.year,
        source: row.source.toLowerCase(),
        amountCents: row.amountCents,
        fedTaxCents: row.fedTaxCents,
        stateTaxCents: row.stateTaxCents,
        localTaxCents: row.localTaxCents,
        medicareCents: row.medicareCents,
        socialSecurityCents: row.socialSecurityCents,
      });
      imported += 1;
    }
  });

  revalidatePath("/income");
  return { imported, skippedDuplicates: input.length - imported };
}

export async function deleteForecast(forecastId: string) {
  const householdId = await getCurrentHousehold();
  await db
    .delete(incomeForecasts)
    .where(
      and(
        eq(incomeForecasts.id, forecastId),
        eq(incomeForecasts.householdId, householdId),
      ),
    );
  revalidatePath("/income");
  redirect("/income");
}
