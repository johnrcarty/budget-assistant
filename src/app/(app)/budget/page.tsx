import { IngressLink } from "@/components/layout/ingress";
import { ChartNoAxesColumn, ChevronRight } from "lucide-react";
import { getCurrentHousehold } from "@/server/lib/dal";
import { getBudgetOverview } from "@/server/db/queries/budget";
import { currentMonthString } from "@/lib/month";
import { formatCents } from "@/server/lib/money";
import { isDisplayMode } from "@/components/budget/display-mode";
import { MonthHeader } from "@/components/budget/MonthHeader";
import { CategoryGroupCard } from "@/components/budget/CategoryGroupCard";
import { AddCategoryGroupDialog } from "@/components/budget/AddCategoryGroupDialog";
import { CreateMonthBudgetPrompt } from "@/components/budget/CreateMonthBudgetPrompt";

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; mode?: string }>;
}) {
  const params = await searchParams;
  const month = params.month ?? currentMonthString();
  const mode = isDisplayMode(params.mode) ? params.mode : "planned";

  const householdId = await getCurrentHousehold();
  const overview = await getBudgetOverview(householdId, month);

  return (
    <div>
      <MonthHeader
        month={month}
        basePath="/budget"
        mode={mode}
        rightAction={<AddCategoryGroupDialog />}
      />

      {!overview.hasBudget && overview.previousMonthWithBudget ? (
        <CreateMonthBudgetPrompt
          month={month}
          previousMonth={overview.previousMonthWithBudget.month}
        />
      ) : (
        <div className="p-4">
          <p className="pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Left to budget
          </p>
          <p className="pb-4 text-3xl font-bold text-primary">
            {formatCents(overview.leftToBudgetCents)}
          </p>

          <IngressLink
            href={`/budget/income?month=${month}`}
            className="mb-6 flex items-center justify-between rounded-xl bg-card p-4 shadow-xs"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <ChartNoAxesColumn className="size-5 text-muted-foreground" />
              </div>
              <div>
                <div className="text-xs tracking-wide text-muted-foreground uppercase">
                  Planned Income
                </div>
                <div className="text-lg font-bold">
                  {formatCents(overview.plannedIncomeCents)}
                </div>
              </div>
            </div>
            <ChevronRight className="size-5 text-muted-foreground" />
          </IngressLink>

          {overview.groups.length > 0 && (
            <p className="pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Budget Categories
            </p>
          )}

          <div className="flex flex-col gap-4">
            {overview.groups.map((group) => (
              <CategoryGroupCard
                key={group.id}
                group={group}
                month={month}
                mode={mode}
              />
            ))}
          </div>

          {overview.groups.length === 0 && (
            <p className="pt-8 text-center text-muted-foreground">
              No categories yet — tap + above to add your first group.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
