// Pure layout math for the debt burn-down chart - no React, no DOM.
// History (real snapshots) renders solid; projection (simulator timeline)
// renders dashed/faded after the divider.

export interface BurnDownPoint {
  label: string; // "Mar 2027" - preformatted server-side
  totalFormatted: string; // "$12,430.00" - preformatted server-side
  totalCents: number;
  perDebtCents: Record<string, number>;
  projected: boolean;
}

export interface BurnDownDebt {
  accountId: string;
  label: string;
  color: string; // CSS color string, e.g. "var(--chart-1)"
}

export interface BurnDownLayout {
  width: number;
  height: number;
  plotTop: number;
  plotBottom: number;
  // One stacked band per debt, spanning history + projection. The strategy
  // target stacks at the bottom so it visibly burns to nothing first.
  areas: { accountId: string; color: string; path: string }[];
  totalLineHistory: string | null; // solid polyline path
  totalLineProjected: string | null; // dashed polyline path
  dividerX: number | null; // x of the first projected point
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
  pointXs: number[]; // x per point index, for scrub snapping
}

const HEIGHT = 260;
const PAD_TOP = 8;
const PAD_BOTTOM = 22;
const PAD_X = 4;

function compactUsd(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(dollars)}`;
}

// A rounded-up axis max so the top gridline is a clean number.
function niceMaxCents(maxCents: number): number {
  if (maxCents <= 0) return 100;
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxCents)));
  for (const mult of [1, 2, 2.5, 5, 10]) {
    if (maxCents <= magnitude * mult) return magnitude * mult;
  }
  return magnitude * 10;
}

export function layoutBurnDown(
  points: BurnDownPoint[],
  debts: BurnDownDebt[],
  width: number,
): BurnDownLayout | null {
  if (points.length < 2 || width <= 0) return null;

  const plotTop = PAD_TOP;
  const plotBottom = HEIGHT - PAD_BOTTOM;
  const plotHeight = plotBottom - plotTop;

  const maxCents = niceMaxCents(Math.max(...points.map((p) => p.totalCents)));
  const xFor = (index: number) =>
    PAD_X + (index * (width - 2 * PAD_X)) / (points.length - 1);
  const yFor = (cents: number) => plotBottom - (cents / maxCents) * plotHeight;

  const pointXs = points.map((_, i) => xFor(i));

  // Stacked bands, bottom-up in the given debt order.
  const areas: BurnDownLayout["areas"] = [];
  const stackBottom = points.map(() => 0);
  for (const debt of debts) {
    const bottoms = [...stackBottom];
    const tops = points.map((p, i) => {
      const value = p.perDebtCents[debt.accountId] ?? 0;
      stackBottom[i] += value;
      return stackBottom[i];
    });
    const forward = points
      .map((_, i) => `${i === 0 ? "M" : "L"} ${xFor(i)},${yFor(tops[i])}`)
      .join(" ");
    const backward = [...points.keys()]
      .reverse()
      .map((i) => `L ${xFor(i)},${yFor(bottoms[i])}`)
      .join(" ");
    areas.push({ accountId: debt.accountId, color: debt.color, path: `${forward} ${backward} Z` });
  }

  const firstProjected = points.findIndex((p) => p.projected);
  const linePath = (indices: number[]) =>
    indices.length >= 2
      ? indices
          .map((i, j) => `${j === 0 ? "M" : "L"} ${xFor(i)},${yFor(points[i].totalCents)}`)
          .join(" ")
      : null;

  // The projected line starts at the last history point so the total line
  // is continuous across the divider without double-drawing any segment.
  const historyIndices = points.map((_, i) => i).filter((i) => !points[i].projected);
  const projectedIndices =
    firstProjected === -1
      ? []
      : [
          ...(firstProjected > 0 ? [firstProjected - 1] : []),
          ...points.map((_, i) => i).filter((i) => points[i].projected),
        ];

  const tickCount = Math.min(4, points.length);
  const xTicks = Array.from({ length: tickCount }, (_, t) => {
    const index = Math.round((t * (points.length - 1)) / (tickCount - 1 || 1));
    return { x: xFor(index), label: points[index].label };
  });

  const yTicks = [0.5, 1].map((fraction) => ({
    y: yFor(maxCents * fraction),
    label: compactUsd(maxCents * fraction),
  }));

  return {
    width,
    height: HEIGHT,
    plotTop,
    plotBottom,
    areas,
    totalLineHistory: linePath(historyIndices),
    totalLineProjected:
      firstProjected === -1 ? null : linePath(projectedIndices),
    dividerX: firstProjected > 0 ? xFor(firstProjected) : null,
    xTicks,
    yTicks,
    pointXs,
  };
}

export function nearestPointIndex(pointXs: number[], x: number): number {
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
