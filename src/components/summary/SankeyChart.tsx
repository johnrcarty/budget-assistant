"use client";

import { IngressLink } from "@/components/layout/ingress";
import { useEffect, useRef, useState } from "react";
import {
  layoutSankey,
  NODE_WIDTH,
  type PositionedNode,
  type SankeyGraphLink,
  type SankeyGraphNode,
} from "./sankey-layout";

const LABEL_HEIGHT = 30;
const MIN_LABELED_NODE_HEIGHT = 10;

// Per column, top to bottom: skip labels on tiny nodes and labels that would
// overlap the previous kept one - a tap reveals them in the caption row.
function visibleLabelIds(nodes: PositionedNode[]): Set<string> {
  const visible = new Set<string>();
  const tiers = new Map<number, PositionedNode[]>();
  for (const node of nodes) {
    const tierNodes = tiers.get(node.tier) ?? [];
    tierNodes.push(node);
    tiers.set(node.tier, tierNodes);
  }
  for (const tierNodes of tiers.values()) {
    let lastBottom = -Infinity;
    for (const node of [...tierNodes].sort((a, b) => a.y - b.y)) {
      if (node.height < MIN_LABELED_NODE_HEIGHT) continue;
      if (node.y < lastBottom) continue;
      visible.add(node.id);
      lastBottom = node.y + LABEL_HEIGHT;
    }
  }
  return visible;
}

// Only these node kinds map to a concrete transaction set (see
// resolveFlowCondition); cashflow/surplus/deficit are computed totals.
function isFilterable(nodeId: string): boolean {
  return (
    nodeId.startsWith("src:") || nodeId.startsWith("grp:") || nodeId.startsWith("item:")
  );
}

export function SankeyChart({
  nodes,
  links,
  ariaLabel,
  range,
}: {
  nodes: SankeyGraphNode[];
  links: SankeyGraphLink[];
  ariaLabel: string;
  range: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0].contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = width > 0 ? layoutSankey(nodes, links, width) : null;
  const labeled = layout ? visibleLabelIds(layout.nodes) : new Set<string>();
  const selected = layout?.nodes.find((node) => node.id === selectedId) ?? null;
  const maxTier = layout ? Math.max(...layout.nodes.map((node) => node.tier)) : 0;

  const toggleNode = (id: string) => {
    setSelectedId((current) => (current === id ? null : id));
  };

  return (
    <div ref={containerRef}>
      {layout && (
        <>
          <svg
            width={width}
            height={layout.height}
            role="img"
            aria-label={ariaLabel}
            className="block"
            onClick={(event) => {
              if (event.target === event.currentTarget) setSelectedId(null);
            }}
          >
            {layout.links.map((link) => {
              const connected =
                selectedId !== null &&
                (link.sourceId === selectedId || link.targetId === selectedId);
              return (
                <path
                  key={`${link.sourceId}→${link.targetId}`}
                  d={link.path}
                  // var() colors don't resolve in SVG presentation
                  // attributes, only in CSS - hence style, not fill=
                  style={{
                    fill: link.color,
                    fillOpacity:
                      selectedId === null
                        ? "var(--sankey-link-alpha)"
                        : connected
                          ? 0.7
                          : 0.08,
                  }}
                />
              );
            })}
            {layout.nodes.map((node) => {
              const isEndColumn = node.tier === maxTier && node.tier > 1;
              const labelX = isEndColumn ? node.x - 6 : node.x + NODE_WIDTH + 6;
              const dimmed = selectedId !== null && selectedId !== node.id;
              return (
                <g
                  key={node.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`${node.label}, ${node.valueFormatted ?? ""}`}
                  className="cursor-pointer outline-none focus-visible:opacity-80"
                  onClick={() => toggleNode(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleNode(node.id);
                    }
                  }}
                >
                  {/* widened invisible hit target for touch */}
                  <rect
                    x={node.x - 6}
                    y={node.y - 2}
                    width={NODE_WIDTH + 12}
                    height={node.height + 4}
                    fill="transparent"
                  />
                  <rect
                    x={node.x}
                    y={node.y}
                    width={NODE_WIDTH}
                    height={node.height}
                    rx={3}
                    style={{ fill: node.color }}
                    opacity={dimmed ? 0.4 : 1}
                  />
                  {labeled.has(node.id) && (
                    <text
                      x={labelX}
                      y={node.y + 4}
                      textAnchor={isEndColumn ? "end" : "start"}
                      dominantBaseline="hanging"
                      className="select-none"
                      opacity={dimmed ? 0.5 : 1}
                    >
                      <tspan
                        x={labelX}
                        className="fill-foreground text-[11px] font-medium"
                      >
                        {node.label}
                      </tspan>
                      <tspan
                        x={labelX}
                        dy={13}
                        className="fill-muted-foreground text-[10px]"
                      >
                        {node.valueFormatted}
                      </tspan>
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <div className="flex h-9 items-center justify-between gap-3 text-sm">
            {selected ? (
              <>
                <p className="min-w-0 truncate">
                  <span className="font-medium">{selected.label}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    — {selected.valueFormatted}
                    {selected.shareLabel ? ` · ${selected.shareLabel}` : ""}
                  </span>
                </p>
                {isFilterable(selected.id) && (
                  <IngressLink
                    href={`/transactions?range=${range}&flow=${encodeURIComponent(
                      selected.id,
                    )}&flowLabel=${encodeURIComponent(selected.label)}`}
                    className="shrink-0 font-medium text-primary"
                  >
                    View transactions
                  </IngressLink>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">Tap a bar for details.</p>
            )}
          </div>
        </>
      )}
      {!layout && <div className="h-[400px]" />}
    </div>
  );
}
