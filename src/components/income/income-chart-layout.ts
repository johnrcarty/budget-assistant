// Pure layout for the annual income chart - no React, no DOM.

export interface IncomeSeries {
  key: string;
  label: string;
  color: string; // CSS color string e.g. "var(--chart-1)"
  dashed: boolean; // forecasts render dashed
  emphasis?: boolean; // the total line renders heavier
  values: Record<number, number>; // year -> cents
}

export interface IncomeChartLayout {
  width: number;
  height: number;
  plotTop: number;
  plotBottom: number;
  lines: { key: string; color: string; dashed: boolean; emphasis: boolean; path: string }[];
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

export function layoutIncomeChart(
  years: number[],
  series: IncomeSeries[],
  width: number,
): IncomeChartLayout | null {
  if (years.length < 2 || width <= 0) return null;

  const plotTop = PAD_TOP;
  const plotBottom = HEIGHT - PAD_BOTTOM;
  const plotHeight = plotBottom - plotTop;

  let max = 0;
  for (const s of series) {
    for (const year of years) {
      const v = s.values[year];
      if (v !== undefined && v > max) max = v;
    }
  }
  const maxCents = niceMaxCents(max);

  const xFor = (index: number) => PAD_X + (index * (width - 2 * PAD_X)) / (years.length - 1);
  const yFor = (cents: number) => plotBottom - (cents / maxCents) * plotHeight;
  const pointXs = years.map((_, i) => xFor(i));

  const lines = series.map((s) => {
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
    return {
      key: s.key,
      color: s.color,
      dashed: s.dashed,
      emphasis: s.emphasis ?? false,
      path,
    };
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

  return { width, height: HEIGHT, plotTop, plotBottom, lines, xTicks, yTicks, pointXs };
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
