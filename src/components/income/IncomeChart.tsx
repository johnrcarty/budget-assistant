"use client";

import { useEffect, useRef, useState } from "react";
import {
  layoutIncomeChart,
  nearestYearIndex,
  toRunningTotals,
  type IncomeSeries,
} from "./income-chart-layout";

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function IncomeChart({
  years,
  stackSeries,
  lineSeries = [],
  ariaLabel,
}: {
  years: number[];
  // Per-person actuals, stacked bottom-up in the given order.
  stackSeries: IncomeSeries[];
  // Forecast overlays, drawn as dashed lines (by-year mode only - mixing
  // projections into an accumulated-history view would be misleading).
  lineSeries?: IncomeSeries[];
  ariaLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [mode, setMode] = useState<"year" | "running">("year");

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0].contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const displayStack =
    mode === "running" ? toRunningTotals(stackSeries, years) : stackSeries;
  const displayLines = mode === "running" ? [] : lineSeries;

  const layout =
    width > 0 ? layoutIncomeChart(years, displayStack, displayLines, width) : null;
  const selectedYear = selectedIndex !== null ? years[selectedIndex] : null;

  const scrub = (clientX: number, currentTarget: Element) => {
    if (!layout) return;
    const rect = currentTarget.getBoundingClientRect();
    setSelectedIndex(nearestYearIndex(layout.pointXs, clientX - rect.left));
  };

  return (
    <div ref={containerRef}>
      <div className="flex justify-end pb-2">
        <div className="flex rounded-lg border p-0.5 text-xs">
          {(
            [
              ["year", "By year"],
              ["running", "Running total"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`rounded-md px-2.5 py-1 font-medium ${
                mode === value
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {layout ? (
        <>
          <svg
            width={layout.width}
            height={layout.height}
            role="img"
            aria-label={ariaLabel}
            className="block touch-pan-y select-none"
            onPointerDown={(e) => scrub(e.clientX, e.currentTarget)}
            onPointerMove={(e) => {
              if (e.buttons > 0 || e.pointerType === "mouse") scrub(e.clientX, e.currentTarget);
            }}
            onPointerLeave={() => setSelectedIndex(null)}
          >
            {layout.yTicks.map((tick) => (
              <g key={tick.y}>
                <line
                  x1={0}
                  x2={layout.width}
                  y1={tick.y}
                  y2={tick.y}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={layout.width - 4}
                  y={tick.y - 4}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px]"
                >
                  {tick.label}
                </text>
              </g>
            ))}

            {/* Stacked bands: color wash fill, full-strength top edge. The
                stack's top edge is the household total by construction. */}
            {layout.bands.map((band) => (
              <g key={band.key}>
                {/* var() colors don't resolve in SVG presentation attributes */}
                <path d={band.areaPath} style={{ fill: band.color }} fillOpacity={0.3} />
                <path
                  d={band.topPath}
                  fill="none"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  style={{ stroke: band.color }}
                />
              </g>
            ))}

            {layout.lines.map((line) => (
              <path
                key={line.key}
                d={line.path}
                fill="none"
                strokeWidth={2}
                strokeDasharray={line.dashed ? "4 4" : undefined}
                strokeOpacity={0.8}
                strokeLinejoin="round"
                strokeLinecap="round"
                style={{ stroke: line.color }}
              />
            ))}

            {selectedIndex !== null && (
              <line
                x1={layout.pointXs[selectedIndex]}
                x2={layout.pointXs[selectedIndex]}
                y1={layout.plotTop}
                y2={layout.plotBottom}
                className="stroke-foreground"
                strokeWidth={1}
                strokeOpacity={0.5}
              />
            )}

            {layout.xTicks.map((tick, i) => (
              <text
                key={tick.x}
                x={tick.x}
                y={layout.height - 6}
                textAnchor={i === 0 ? "start" : i === layout.xTicks.length - 1 ? "end" : "middle"}
                className="fill-muted-foreground text-[10px]"
              >
                {tick.label}
              </text>
            ))}
          </svg>
          <div className="flex min-h-6 flex-wrap items-center gap-x-3 text-sm">
            {selectedYear !== null ? (
              <>
                <span className="font-medium">{selectedYear}</span>
                {displayStack.map((s) => (
                  <span key={s.key} className="text-muted-foreground">
                    {s.label}: {usd(s.values[selectedYear] ?? 0)}
                  </span>
                ))}
                <span className="font-medium">
                  Total:{" "}
                  {usd(
                    displayStack.reduce(
                      (sum, s) => sum + (s.values[selectedYear] ?? 0),
                      0,
                    ),
                  )}
                </span>
                {displayLines
                  .filter((s) => s.values[selectedYear] !== undefined)
                  .map((s) => (
                    <span key={s.key} className="text-muted-foreground">
                      {s.label}: {usd(s.values[selectedYear])}
                    </span>
                  ))}
              </>
            ) : (
              <span className="text-muted-foreground">
                {mode === "running"
                  ? "Cumulative earnings through each year. Drag to inspect."
                  : "Drag across the chart to inspect."}
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="h-[264px]" />
      )}
    </div>
  );
}
