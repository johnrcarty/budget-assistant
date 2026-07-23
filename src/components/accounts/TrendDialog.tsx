"use client";

import { useState } from "react";
import { formatCents, formatCentsCompact } from "@/server/lib/money";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Layout constants for the SVG viewBox; the element itself scales to the
// dialog width.
const W = 560;
const H = 220;
const M = { top: 16, right: 16, bottom: 26, left: 10 };
const innerW = W - M.left - M.right;
const innerH = H - M.top - M.bottom;

function formatPointDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatAxisMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const month = d.toLocaleDateString("en-US", { month: "short" });
  return `${month} '${String(d.getFullYear()).slice(2)}`;
}

// Clean-number gridline values: smallest 1/2/2.5/5 × 10^k step that yields
// at most 5 ticks (and therefore the most ticks possible within that cap).
function buildTicks(min: number, max: number): number[] {
  if (max <= min) return [min];
  const span = max - min;
  const basePow = Math.pow(10, Math.floor(Math.log10(span)) - 1);
  const candidates = [1, 2, 2.5, 5, 10, 20, 25, 50, 100].map((u) => u * basePow);
  for (const step of candidates) {
    const count = Math.floor(max / step) - Math.ceil(min / step) + 1;
    if (count <= 5) {
      const ticks: number[] = [];
      for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
      return ticks;
    }
  }
  return [min, max];
}

export function TrendChart({
  points,
  series,
  isLiability,
  lastPointLabel = "Today",
}: {
  points: string[];
  series: number[];
  isLiability: boolean;
  // The last x-axis tick's label - override when the last point isn't
  // actually today (e.g. sparse yearly snapshots whose latest point is a
  // past year-end).
  lastPointLabel?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const n = points.length;

  let dMin = Math.min(...series);
  let dMax = Math.max(...series);
  if (dMin === dMax) {
    // Flat series: pad so the line sits centered rather than on an edge.
    const pad = Math.max(Math.abs(dMin) * 0.05, 10_000);
    dMin -= pad;
    dMax += pad;
  } else {
    const pad = (dMax - dMin) * 0.1;
    dMin -= pad;
    dMax += pad;
  }

  const x = (i: number) => M.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => M.top + (1 - (v - dMin) / (dMax - dMin)) * innerH;

  const linePath = series.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const areaPath = `${linePath} L${x(n - 1)},${M.top + innerH} L${x(0)},${M.top + innerH} Z`;
  const ticks = buildTicks(dMin, dMax);

  function indexFromPointer(e: React.PointerEvent<SVGSVGElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    const xView = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (xView - M.left) / innerW;
    return Math.min(n - 1, Math.max(0, Math.round(frac * (n - 1))));
  }

  const activeIdx = hoverIdx;
  const tooltipPct =
    activeIdx !== null ? Math.min(88, Math.max(12, (x(activeIdx) / W) * 100)) : 0;

  const lineColorClass = isLiability ? "text-destructive" : "text-primary";

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`Balance trend from ${formatPointDate(points[0])} to ${formatPointDate(points[n - 1])}`}
        tabIndex={0}
        onPointerMove={(e) => setHoverIdx(indexFromPointer(e))}
        onPointerLeave={() => setHoverIdx(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            setHoverIdx((prev) => Math.min(n - 1, (prev ?? n - 1) + 1));
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            setHoverIdx((prev) => Math.max(0, (prev ?? n - 1) - 1));
          } else if (e.key === "Escape") {
            setHoverIdx(null);
          }
        }}
      >
        {/* hairline gridlines with tick labels above, recessive */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(t)}
              y2={y(t)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={M.left}
              y={y(t) - 4}
              className="fill-muted-foreground text-[10px]"
            >
              {formatCentsCompact(t)}
            </text>
          </g>
        ))}

        <g className={lineColorClass}>
          <path d={areaPath} fill="currentColor" opacity={0.1} />
          <path
            d={linePath}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* end dot with a surface ring so it reads over the line */}
          <circle
            cx={x(n - 1)}
            cy={y(series[n - 1])}
            r={4}
            fill="currentColor"
            className="stroke-card"
            strokeWidth={2}
          />
        </g>

        {activeIdx !== null && (
          <g>
            <line
              x1={x(activeIdx)}
              x2={x(activeIdx)}
              y1={M.top}
              y2={M.top + innerH}
              className="stroke-muted-foreground"
              strokeWidth={1}
            />
            <circle
              cx={x(activeIdx)}
              cy={y(series[activeIdx])}
              r={4}
              className={`fill-current stroke-card ${lineColorClass}`}
              strokeWidth={2}
            />
          </g>
        )}

        {/* x-axis: first and last point only; the tooltip carries the rest */}
        <text
          x={M.left}
          y={H - 8}
          className="fill-muted-foreground text-[10px]"
        >
          {formatAxisMonth(points[0])}
        </text>
        <text
          x={W - M.right}
          y={H - 8}
          textAnchor="end"
          className="fill-muted-foreground text-[10px]"
        >
          {lastPointLabel}
        </text>
      </svg>

      {activeIdx !== null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-sm"
          style={{ left: `${tooltipPct}%` }}
        >
          <div className="text-sm font-semibold whitespace-nowrap">
            {formatCents(series[activeIdx])}
          </div>
          <div className="text-xs text-muted-foreground whitespace-nowrap">
            {formatPointDate(points[activeIdx])}
          </div>
        </div>
      )}

      {/* non-hover access to every value */}
      <ul className="sr-only">
        {points.map((point, i) => (
          <li key={point}>
            {formatPointDate(point)}: {formatCents(series[i])}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TrendDialog({
  title,
  points,
  series,
  isLiability = false,
  changeLabel = "over the last 12 months",
  lastPointLabel = "Today",
  trigger,
  triggerClassName,
}: {
  title: string;
  points: string[];
  series: number[];
  // Draws the line in the liability color and flips the "is up good?"
  // reading of the change (owing less is the good direction).
  isLiability?: boolean;
  // Caption after the change figure - override for callers whose points
  // aren't a trailing-12-month trend (e.g. sparse yearly snapshots).
  changeLabel?: string;
  lastPointLabel?: string;
  trigger: React.ReactNode;
  triggerClassName?: string;
}) {
  const current = series[series.length - 1];
  const first = series[0];
  const change = current - first;
  const goodDirection = isLiability ? change < 0 : change > 0;
  const changeColorClass =
    change === 0 ? "text-muted-foreground" : goodDirection ? "text-primary" : "text-destructive";

  return (
    <Dialog>
      <DialogTrigger className={triggerClassName}>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div>
            <div className="text-2xl font-semibold">{formatCents(current)}</div>
            <div className="text-sm text-muted-foreground">
              <span className={`font-medium ${changeColorClass}`}>
                {change >= 0 ? "+" : ""}
                {formatCents(change)}
              </span>{" "}
              {changeLabel}
            </div>
          </div>
          <TrendChart
            points={points}
            series={series}
            isLiability={isLiability}
            lastPointLabel={lastPointLabel}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
