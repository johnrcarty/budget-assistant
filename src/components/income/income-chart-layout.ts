// Pure layout for the annual income chart - no React, no DOM.

export interface IncomeSeries {
  key: string;
  label: string;
  color: string; // CSS color string e.g. "var(--chart-1)"
  dashed: boolean; // forecasts render dashed
  values: Record<number, number>; // year -> cents
}

// One band of the stacked area: a closed fill path plus its top edge as an
// open line (the edge carries the series color at full strength; the fill
// is a wash underneath).
export interface IncomeStackBand {
  key: string;
  color: string;
  areaPath: string;
  topPath: string;
}

export interface IncomeChartLayout {
  width: number;
  height: number;
  plotTop: number;
  plotBottom: number;
  bands: IncomeStackBand[];
  lines: { key: string; color: string; dashed: boolean; path: string }[];
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
  pointXs: number[]; // x per year index
}

const HEIGHT = 240;
const PAD_TOP = 8;
const PAD_BOTTOM = 22;
const PAD_X = 4;

function compactUsd(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(dollars)}`;
}

function niceMaxCents(maxCents: number): number {
  if (maxCents <= 0) return 100;
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxCents)));
  for (const mult of [1, 2, 2.5, 5, 10]) {
    if (maxCents <= magnitude * mult) return magnitude * mult;
  }
  return magnitude * 10;
}

// Stacked areas for `stackSeries` (missing years contribute 0, so the
// stack's top edge is always the true total) plus plain overlay lines for
// `lineSeries` (forecasts). The y-scale covers whichever is taller.
export function layoutIncomeChart(
  years: number[],
  stackSeries: IncomeSeries[],
  lineSeries: IncomeSeries[],
  width: number,
): IncomeChartLayout | null {
  if (years.length < 2 || width <= 0) return null;

  const plotTop = PAD_TOP;
  const plotBottom = HEIGHT - PAD_BOTTOM;
  const plotHeight = plotBottom - plotTop;

  let max = 0;
  for (const year of years) {
    const stackSum = stackSeries.reduce((sum, s) => sum + (s.values[year] ?? 0), 0);
    if (stackSum > max) max = stackSum;
    for (const s of lineSeries) {
      const v = s.values[year];
      if (v !== undefined && v > max) max = v;
    }
  }
  const maxCents = niceMaxCents(max);

  const xFor = (index: number) => PAD_X + (index * (width - 2 * PAD_X)) / (years.length - 1);
  const yFor = (cents: number) => plotBottom - (cents / maxCents) * plotHeight;
  const pointXs = years.map((_, i) => xFor(i));

  // Running lower edge of the next band, per year index.
  const lower = years.map(() => 0);
  const bands = stackSeries.map((s) => {
    const upper = years.map((year, i) => lower[i] + (s.values[year] ?? 0));

    const topPoints = years.map((_, i) => `${xFor(i)},${yFor(upper[i])}`);
    const topPath = topPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p}`).join(" ");
    const backPoints = years
      .map((_, i) => `${xFor(i)},${yFor(lower[i])}`)
      .reverse();
    const areaPath = `${topPath} ${backPoints.map((p) => `L ${p}`).join(" ")} Z`;

    for (let i = 0; i < years.length; i++) lower[i] = upper[i];
    return { key: s.key, color: s.color, areaPath, topPath };
  });

  const lines = lineSeries.map((s) => {
    let path = "";
    let penDown = false;
    years.forEach((year, i) => {
      const value = s.values[year];
      if (value === undefined) {
        penDown = false;
        return;
      }
      path += `${penDown ? " L" : `${path ? " " : ""}M`} ${xFor(i)},${yFor(value)}`;
      penDown = true;
    });
    return { key: s.key, color: s.color, dashed: s.dashed, path };
  });

  const tickCount = Math.min(5, years.length);
  const xTicks = Array.from({ length: tickCount }, (_, t) => {
    const index = Math.round((t * (years.length - 1)) / (tickCount - 1 || 1));
    return { x: xFor(index), label: String(years[index]) };
  });

  const yTicks = [0.5, 1].map((fraction) => ({
    y: yFor(maxCents * fraction),
    label: compactUsd(maxCents * fraction),
  }));

  return { width, height: HEIGHT, plotTop, plotBottom, bands, lines, xTicks, yTicks, pointXs };
}

// Cumulative view of the same series: each year's value is the sum of all
// values up to and including that year (missing years add 0, so the curve
// holds flat through gaps instead of disappearing).
export function toRunningTotals(series: IncomeSeries[], years: number[]): IncomeSeries[] {
  return series.map((s) => {
    const values: Record<number, number> = {};
    let running = 0;
    for (const year of years) {
      running += s.values[year] ?? 0;
      values[year] = running;
    }
    return { ...s, values };
  });
}

export function nearestYearIndex(pointXs: number[], x: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < pointXs.length; i++) {
    const dist = Math.abs(pointXs[i] - x);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}
