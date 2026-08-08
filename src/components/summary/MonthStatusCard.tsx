import { IngressLink } from "@/components/layout/ingress";
import type { getBudgetOverview } from "@/server/db/queries/budget";
import { formatMonthShort } from "@/lib/month";
import { sumSpentCents } from "@/lib/budget-totals";
import { formatCents } from "@/server/lib/money";

type BudgetOverview = Awaited<ReturnType<typeof getBudgetOverview>>;

export function MonthStatusCard({
  overview,
  month,
}: {
  overview: BudgetOverview;
  month: string;
}) {
  const monthName = formatMonthShort(month);

  if (!overview.hasBudget) {
    return (
      <div className="rounded-xl bg-card p-4 shadow-xs">
        <h2 className="font-semibold">{monthName} budget</h2>
        <p className="pt-3 text-sm text-muted-foreground">
          No budget for {monthName} yet.
        </p>
        <IngressLink href="/budget" className="mt-3 inline-block text-sm font-medium text-primary">
          Create it in the Budget tab →
        </IngressLink>
      </div>
    );
  }

  const spentCents = sumSpentCents(overview.groups);
  const plannedCents = overview.plannedExpensesCents;
  const overspent = spentCents > plannedCents;
  const progressPct =
    plannedCents > 0 ? Math.min(100, Math.round((spentCents / plannedCents) * 100)) : 0;
  const leftToBudget = overview.leftToBudgetCents;

  return (
    <div className="rounded-xl bg-card p-4 shadow-xs">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">{monthName} budget</h2>
        <IngressLink href="/budget" className="text-sm font-medium text-primary">
          Open budget →
        </IngressLink>
      </div>

      <div className="pt-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{formatCents(spentCents)}</span>{" "}
        spent of {formatCents(plannedCents)} planned
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${overspent ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <div className="pt-2 text-sm text-muted-foreground">
        {overspent
          ? `${formatCents(spentCents - plannedCents)} over plan`
          : `${formatCents(plannedCents - spentCents)} remaining`}
      </div>

      {leftToBudget !== 0 && (
        <p
          className={`pt-2 text-sm font-medium ${
            leftToBudget > 0 ? "text-primary" : "text-destructive"
          }`}
        >
          {leftToBudget > 0
            ? `${formatCents(leftToBudget)} left to budget`
            : `Overbudgeted by ${formatCents(-leftToBudget)}`}
        </p>
      )}
    </div>
  );
}
