"use client";

import { useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { formatCents } from "@/server/lib/money";
import { MODE_COLUMNS_GRID } from "./display-mode";

export interface StandingItem {
  id: string;
  name: string;
  plannedCents: number;
  spentCents: number;
}

// The tappable category header plus its collapsible standing panel: a meter
// per line item (spent against planned). Client component so the toggle is
// instant; everything server-flavored in the header (totals, the Archive
// form) comes in as pre-rendered slots.
export function GroupStanding({
  title,
  icon,
  archive,
  mobileSummary,
  desktopTotals,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  // Archive form, shown next to the name on desktop only.
  archive?: React.ReactNode;
  // Active-mode total + Archive cluster (mobile header's right side).
  mobileSummary: React.ReactNode;
  // One total per Planned/Spent/Remaining column (desktop header).
  desktopTotals: React.ReactNode;
  items: StandingItem[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className={`flex items-center justify-between gap-3 pb-2 ${MODE_COLUMNS_GRID}`}>
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex min-w-0 items-center gap-3 text-left"
          >
            {icon}
            <h2 className="truncate text-lg font-bold">{title}</h2>
            <ChevronDown
              className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>
          <div className="hidden md:block">{archive}</div>
        </div>
        <div className="flex shrink-0 items-center gap-3 md:hidden">{mobileSummary}</div>
        {desktopTotals}
      </div>

      {open && <StandingPanel items={items} />}
    </>
  );
}

function StandingPanel({ items }: { items: StandingItem[] }) {
  if (items.length === 0) {
    return (
      <p className="border-b pb-3 text-sm text-muted-foreground">
        Nothing here to chart yet.
      </p>
    );
  }

  const plannedTotal = items.reduce((sum, i) => sum + i.plannedCents, 0);
  const spentTotal = items.reduce((sum, i) => sum + i.spentCents, 0);

  return (
    <div className="flex flex-col gap-3 border-b pt-1 pb-4">
      <Meter name="Total" plannedCents={plannedTotal} spentCents={spentTotal} emphasis />
      {items.map((item) => (
        <Meter
          key={item.id}
          name={item.name}
          plannedCents={item.plannedCents}
          spentCents={item.spentCents}
        />
      ))}
    </div>
  );
}

function Meter({
  name,
  plannedCents,
  spentCents,
  emphasis = false,
}: {
  name: string;
  plannedCents: number;
  spentCents: number;
  emphasis?: boolean;
}) {
  const over = spentCents > plannedCents;
  const ratio =
    plannedCents > 0
      ? spentCents / plannedCents
      : // No plan: nothing spent is an empty meter, anything spent is over.
        spentCents > 0
        ? 1
        : 0;
  const fillPct = Math.min(100, Math.max(0, ratio * 100));

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={`min-w-0 truncate ${emphasis ? "font-semibold" : "font-medium"}`}>
          {name}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {formatCents(spentCents)} of {formatCents(plannedCents)}
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${name}: ${formatCents(spentCents)} spent of ${formatCents(plannedCents)} planned`}
        aria-valuenow={Math.round(fillPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        // Track is a lighter step of the fill's own hue, so over/under state
        // reads across the whole bar, not just the filled part.
        className={`mt-1.5 h-2 overflow-hidden rounded-full ${
          over ? "bg-destructive/15" : "bg-primary/15"
        }`}
      >
        <div
          className={`h-full rounded-full ${over ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${fillPct}%` }}
        />
      </div>
      {over && (
        <div className="mt-1 flex items-center gap-1 text-xs font-medium text-destructive">
          <TriangleAlert className="size-3" />
          {plannedCents > 0
            ? `Over by ${formatCents(spentCents - plannedCents)}`
            : `${formatCents(spentCents)} spent with nothing planned`}
        </div>
      )}
    </div>
  );
}
