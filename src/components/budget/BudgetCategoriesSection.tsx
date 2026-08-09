"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { BudgetGroupItem } from "@/server/db/queries/budget";
import { AddCategoryGroupDialog } from "./AddCategoryGroupDialog";
import { BudgetMetricSelector } from "./BudgetMetricSelector";
import { CategoryCard } from "./CategoryCard";
import type { DisplayMode } from "./display-mode";

// Lean, serializable slice of the overview a category card needs.
export interface CategoryGroupData {
  id: string;
  name: string;
  icon: string | null;
  systemKey: string | null;
  items: BudgetGroupItem[];
}

// Client wrapper so switching Planned/Spent/Remaining is instant local state
// instead of a ?mode= navigation - under HA ingress every navigation is a
// full page load, which used to reset the scroll position on every switch.
export function BudgetCategoriesSection({
  month,
  groups,
}: {
  month: string;
  groups: CategoryGroupData[];
}) {
  const [metric, setMetric] = useState<DisplayMode>("spent");

  return (
    <section>
      <div className="flex items-center justify-between pb-2">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Categories
        </h2>
        <BudgetMetricSelector value={metric} onChange={setMetric} />
      </div>

      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <CategoryCard
            key={group.id}
            group={group}
            month={month}
            metric={metric}
          />
        ))}
      </div>

      {groups.length === 0 && (
        <p className="pt-8 text-center text-muted-foreground">
          No categories yet — add your first group below.
        </p>
      )}

      <div className="flex justify-center pt-4">
        <AddCategoryGroupDialog
          triggerClassName="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          triggerContent={
            <>
              <Plus className="size-4" />
              Add Group
            </>
          }
        />
      </div>
    </section>
  );
}
