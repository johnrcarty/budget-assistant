"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatCents } from "@/server/lib/money";
import { percentOfPlan } from "@/lib/segmented-progress";
import { SegmentedProgress } from "./SegmentedProgress";
import { CategoryIcon } from "./category-icons";
import { LineItemRow } from "./LineItemRow";
import { AddLineItemDialog } from "./AddLineItemDialog";
import { CategoryCardMenu } from "./CategoryCardMenu";
import { amountForMode, type DisplayMode } from "./display-mode";
import type { CategoryGroupData } from "./BudgetCategoriesSection";

// Compact collapsed-by-default category card: name, active-metric total,
// segmented progress and remaining at a glance; items expand inline.
export function CategoryCard({
  group,
  month,
  metric,
}: {
  group: CategoryGroupData;
  month: string;
  metric: DisplayMode;
}) {
  const [open, setOpen] = useState(false);

  // The app-managed Debt section is a system default: it wears the liability
  // color rather than brand green, and has no Add Item, Rename or Archive -
  // its items exist only through debt-account linking.
  const isDebtGroup = group.systemKey === "debt";

  const plannedCents = group.items.reduce(
    (sum, item) => sum + item.plannedAmountCents,
    0,
  );
  const spentCents = group.items.reduce((sum, item) => sum + item.spentCents, 0);
  const activeCents = amountForMode(plannedCents, spentCents, metric);
  const remainingCents = plannedCents - spentCents;
  const pct = percentOfPlan(spentCents, plannedCents);

  return (
    <div className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-col gap-2.5 p-4 text-left"
      >
        <span className="flex w-full items-center gap-3">
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
              isDebtGroup ? "bg-destructive/10" : "bg-muted"
            }`}
          >
            <CategoryIcon
              name={group.name}
              storedIcon={group.icon}
              className={`size-4 ${isDebtGroup ? "text-destructive" : "text-primary"}`}
            />
          </span>
          <span className="min-w-0 flex-1 truncate font-serif text-lg">
            {group.name}
          </span>
          <span className="shrink-0 text-right tabular-nums">
            <span className="font-medium">{formatCents(activeCents)}</span>
            {metric !== "planned" && (
              <span className="text-sm text-muted-foreground">
                {" "}
                / {formatCents(plannedCents)}
              </span>
            )}
          </span>
        </span>

        <span className="flex w-full items-center gap-3">
          <SegmentedProgress
            spentCents={spentCents}
            plannedCents={plannedCents}
            className="min-w-0 flex-1"
            aria-label={`${group.name}: spent of planned`}
          />
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {plannedCents > 0 ? `${pct}%` : "—"}
          </span>
        </span>

        <span className="flex w-full items-center justify-between text-xs text-muted-foreground">
          <span
            className={`tabular-nums ${remainingCents < 0 ? "font-medium text-destructive" : ""}`}
          >
            {remainingCents < 0
              ? `${formatCents(-remainingCents)} over`
              : `${formatCents(remainingCents)} remaining`}
          </span>
          <ChevronDown
            className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {open && (
        <div className="border-t px-4 pb-3">
          {group.items.length === 0 && (
            <p className="py-3 text-sm text-muted-foreground">No items yet</p>
          )}
          {group.items.map((item) => (
            <LineItemRow
              key={item.id ?? `projected:${item.templateId}`}
              item={item}
              month={month}
              mode={metric}
            />
          ))}
          {!isDebtGroup && (
            <div className="flex items-center justify-between pt-3">
              <AddLineItemDialog categoryGroupId={group.id} month={month} />
              <CategoryCardMenu groupId={group.id} groupName={group.name} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
