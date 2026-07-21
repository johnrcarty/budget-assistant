"use client";

import { useEffect, useRef, useState } from "react";
import {
  layoutBurnDown,
  nearestPointIndex,
  type BurnDownDebt,
  type BurnDownPoint,
} from "./burn-down-layout";

export function BurnDownChart({
  points,
  debts,
  ariaLabel,
}: {
  points: BurnDownPoint[];
  debts: BurnDownDebt[];
  ariaLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0].contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = width > 0 ? layoutBurnDown(points, debts, width) : null;
  const selected = selectedIndex !== null ? points[selectedIndex] : null;

  const scrub = (clientX: number, currentTarget: Element) => {
    if (!layout) return;
    const rect = currentTarget.getBoundingClientRect();
    setSelectedIndex(nearestPointIndex(layout.pointXs, clientX - rect.left));
  };

  return (
    <div ref={containerRef}>
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

            {layout.areas.map((area) => (
              <path
                key={area.accountId}
                d={area.path}
                // var() colors don't resolve in SVG presentation attributes
                style={{ fill: area.color, fillOpacity: "var(--sankey-link-alpha)" }}
              />
            ))}

            {layout.dividerX !== null && (
              <line
                x1={layout.dividerX}
                x2={layout.dividerX}
                y1={layout.plotTop}
                y2={layout.plotBottom}
                className="stroke-muted-foreground"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
            )}

            {layout.totalLineHistory && (
              <path
                d={layout.totalLineHistory}
                fill="none"
                className="stroke-foreground"
                strokeWidth={2}
              />
            )}
            {layout.totalLineProjected && (
              <path
                d={layout.totalLineProjected}
                fill="none"
                className="stroke-foreground"
                strokeWidth={2}
                strokeDasharray="4 4"
                strokeOpacity={0.7}
              />
            )}

            {selected !== null && selectedIndex !== null && (
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
          <div className="flex h-6 items-center text-sm">
            {selected ? (
              <p className="truncate">
                <span className="font-medium">{selected.label}</span>
                <span className="text-muted-foreground">
                  {" "}
                  — {selected.totalFormatted}
                  {selected.projected ? " · projected" : ""}
                </span>
              </p>
            ) : (
              <p className="text-muted-foreground">Drag across the chart to inspect.</p>
            )}
          </div>
        </>
      ) : (
        <div className="h-[286px]" />
      )}
    </div>
  );
}
