import { Plus, TrendingUp } from "lucide-react";
import { getCurrentHousehold } from "@/server/lib/dal";
import {
  getAnnualIncomeData,
  getForecastPoints,
  entryWithheldCents,
} from "@/server/db/queries/annual-income";
import { deleteForecast } from "@/server/actions/annual-income";
import { formatCents } from "@/server/lib/money";
import { AppHeader } from "@/components/layout/AppHeader";
import { IncomeChart } from "@/components/income/IncomeChart";
import type { IncomeSeries } from "@/components/income/income-chart-layout";
import { IncomeEntryDialog } from "@/components/income/IncomeEntryDialog";
import { ForecastDialog } from "@/components/income/ForecastDialog";
import { ForecastPicker } from "@/components/income/ForecastPicker";
import { Button } from "@/components/ui/button";

function personColor(index: number): string {
  return index < 8 ? `var(--chart-${index + 1})` : "var(--muted-foreground)";
}

// Whole dollars in the summary table - cents live on the entry rows.
function usdWhole(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function pctChange(current: number, previous: number | undefined): string {
  if (!previous) return "—";
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<{ forecast?: string }>;
}) {
  const params = await searchParams;
  const householdId = await getCurrentHousehold();
  const data = await getAnnualIncomeData(householdId);
  const currentYear = new Date().getFullYear();

  // Default to the newest forecast; "none" = actuals only.
  const selectedForecastId =
    params.forecast === "none"
      ? null
      : data.forecasts.some((f) => f.id === params.forecast)
        ? params.forecast!
        : (data.forecasts[0]?.id ?? null);
  const forecastData = selectedForecastId
    ? await getForecastPoints(householdId, selectedForecastId)
    : null;

  const addButton = (
    <IncomeEntryDialog
      persons={data.persons}
      defaultYear={currentYear}
      triggerClassName="text-foreground"
      trigger={<Plus className="size-6" aria-label="Add income" />}
    />
  );

  if (data.entries.length === 0) {
    return (
      <div>
        <AppHeader title="Income" backHref="/more" rightAction={addButton} />
        <div className="px-4 pt-8 text-center text-muted-foreground">
          <TrendingUp className="mx-auto size-8" />
          <p className="pt-3">
            Track W2/1099 income per person per year, then project it forward.
          </p>
          <p className="pt-1 text-sm">Tap + to add your first year.</p>
        </div>
      </div>
    );
  }

  // Forecast values grouped person -> year, plus a computed total series.
  const forecastByPersonYear: Record<string, Record<number, number>> = {};
  const forecastTotals: Record<number, number> = {};
  if (forecastData) {
    for (const point of forecastData.points) {
      forecastByPersonYear[point.person] ??= {};
      forecastByPersonYear[point.person][point.year] = point.amountCents;
      forecastTotals[point.year] = (forecastTotals[point.year] ?? 0) + point.amountCents;
    }
  }

  const actualTotals: Record<number, number> = Object.fromEntries(
    data.years.map((year) => [year, data.yearTotals[year].grossCents]),
  );

  const chartYears = [
    ...new Set([
      ...data.years,
      ...Object.keys(forecastTotals).map(Number),
    ]),
  ].sort((a, b) => a - b);

  const series: IncomeSeries[] = [
    ...data.persons.map((person, index) => ({
      key: `actual:${person}`,
      label: person,
      color: personColor(index),
      dashed: false,
      values: data.byPersonYear[person] ?? {},
    })),
    {
      key: "actual:total",
      label: "Total",
      color: "var(--foreground)",
      dashed: false,
      emphasis: true,
      values: actualTotals,
    },
    ...(forecastData
      ? [
          ...data.persons
            .filter((person) => forecastByPersonYear[person])
            .map((person, index) => ({
              key: `forecast:${person}`,
              label: `${person} (proj.)`,
              color: personColor(data.persons.indexOf(person) ?? index),
              dashed: true,
              values: forecastByPersonYear[person],
            })),
          {
            key: "forecast:total",
            label: "Total (proj.)",
            color: "var(--foreground)",
            dashed: true,
            values: forecastTotals,
          },
        ]
      : []),
  ];

  // Table rows: actual years plus (when a forecast is selected) its
  // projected years. Overlap years show the actual with the projection's
  // miss/hit underneath - that's the whole point of keeping old forecasts.
  const rows = chartYears.map((year) => {
    const hasActual = actualTotals[year] !== undefined;
    const totalCents = hasActual ? actualTotals[year] : forecastTotals[year];
    return {
      year,
      hasActual,
      isProjection: !hasActual,
      projectedTotal: forecastTotals[year],
      totalCents,
      personCents: data.persons.map((person) =>
        hasActual
          ? (data.byPersonYear[person]?.[year] ?? null)
          : (forecastByPersonYear[person]?.[year] ?? null),
      ),
    };
  });

  const entryYearsDesc = [...data.years].reverse();

  return (
    <div>
      <AppHeader title="Income" backHref="/more" rightAction={addButton} />
      <div className="flex flex-col gap-4 px-4 pb-4">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ForecastPicker
              forecasts={data.forecasts.map((f) => ({
                id: f.id,
                name: f.name,
                baseYear: f.baseYear,
              }))}
              selectedId={selectedForecastId}
            />
          </div>
          <ForecastDialog
            years={data.years}
            triggerClassName="shrink-0"
            trigger={
              <Button render={<span />} variant="outline" size="sm">
                New forecast
              </Button>
            }
          />
        </div>

        <div className="rounded-xl bg-card p-4 shadow-xs">
          <div className="flex items-baseline justify-between pb-2">
            <h2 className="font-semibold">Income by year</h2>
            {forecastData && (
              <span className="text-xs text-muted-foreground">
                dashed = {forecastData.forecast.name}
              </span>
            )}
          </div>
          <IncomeChart
            years={chartYears}
            series={series}
            ariaLabel={`Annual income for ${data.persons.join(" and ")}, ${chartYears[0]} through ${chartYears[chartYears.length - 1]}.`}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
            {data.persons.map((person, index) => (
              <span key={person} className="flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: personColor(index) }}
                />
                {person}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-foreground" />
              Total
            </span>
          </div>
        </div>

        <div className="rounded-xl bg-card p-4 shadow-xs">
          <h2 className="pb-2 font-semibold">Year by year</h2>
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[340px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Year</th>
                  {data.persons.map((person) => (
                    <th key={person} className="py-2 pr-2 text-right font-medium">
                      {person}
                    </th>
                  ))}
                  <th className="py-2 pr-2 text-right font-medium">Total</th>
                  <th className="py-2 text-right font-medium">Δ%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={row.year}
                    className={`border-b last:border-b-0 ${row.isProjection ? "bg-amber-500/5 text-muted-foreground" : ""}`}
                  >
                    <td className="py-2 pr-2 font-medium">
                      {row.year}
                      {row.isProjection && <span className="text-xs"> *</span>}
                    </td>
                    {row.personCents.map((cents, personIndex) => (
                      <td key={personIndex} className="py-2 pr-2 text-right whitespace-nowrap">
                        {cents !== null ? usdWhole(cents) : "—"}
                      </td>
                    ))}
                    <td className="py-2 pr-2 text-right whitespace-nowrap font-medium">
                      {usdWhole(row.totalCents)}
                      {row.hasActual && row.projectedTotal !== undefined && (
                        <div className="text-xs font-normal text-muted-foreground">
                          proj {usdWhole(row.projectedTotal)} (
                          {pctChange(row.totalCents, row.projectedTotal)})
                        </div>
                      )}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap text-muted-foreground">
                      {pctChange(row.totalCents, rows[index - 1]?.totalCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {forecastData && (
            <div className="flex items-center justify-between pt-3">
              <p className="text-xs text-muted-foreground">
                * projected · {forecastData.forecast.name}, data through{" "}
                {forecastData.forecast.baseYear}
              </p>
              <form action={deleteForecast.bind(null, forecastData.forecast.id)}>
                <button
                  type="submit"
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Delete forecast
                </button>
              </form>
            </div>
          )}
        </div>

        <div className="rounded-xl bg-card p-4 shadow-xs">
          <h2 className="pb-1 font-semibold">Entries</h2>
          {entryYearsDesc.map((year) => (
            <div key={year} className="pt-2">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {year}
              </h3>
              {data.entries
                .filter((entry) => entry.year === year)
                .map((entry) => {
                  const withheld = entryWithheldCents(entry);
                  return (
                    <IncomeEntryDialog
                      key={entry.id}
                      entry={entry}
                      persons={data.persons}
                      defaultYear={year}
                      triggerClassName="block w-full text-left"
                      trigger={
                        <div className="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">
                              {entry.person}{" "}
                              <span className="font-normal text-muted-foreground">
                                · {entry.source}
                              </span>
                            </div>
                            {withheld > 0 && (
                              <div className="text-sm text-muted-foreground">
                                {formatCents(withheld)} withheld ·{" "}
                                {formatCents(entry.amountCents - withheld)} net
                              </div>
                            )}
                          </div>
                          <div className="shrink-0 font-medium">
                            {formatCents(entry.amountCents)}
                          </div>
                        </div>
                      }
                    />
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
