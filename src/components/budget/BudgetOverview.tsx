import { CircleCheck, TriangleAlert } from "lucide-react";
import { IngressLink } from "@/components/layout/ingress";
import { formatCents } from "@/server/lib/money";
import { percentOfPlan } from "@/lib/segmented-progress";
import { SegmentedProgress } from "./SegmentedProgress";

// The month's financial headline: how much of the plan is left, how spending
// tracks against it, and - envelope-system first - whether every dollar of
// income has a home yet.
export function BudgetOverview({
  plannedIncomeCents,
  plannedExpensesCents,
  spentCents,
  leftToBudgetCents,
  month,
}: {
  plannedIncomeCents: number;
  plannedExpensesCents: number;
  spentCents: number;
  leftToBudgetCents: number;
  month: string;
}) {
  const remainingCents = plannedExpensesCents - spentCents;
  const pct = percentOfPlan(spentCents, plannedExpensesCents);
  const overPlan = spentCents > plannedExpensesCents;

  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-[11px] font-medium tracking-[0.15em] text-muted-foreground uppercase">
        Remaining
      </p>
      <p
        className={`pt-1 font-serif text-5xl font-semibold tabular-nums ${
          remainingCents < 0 ? "text-destructive" : "text-primary"
        }`}
      >
        {formatCents(remainingCents)}
      </p>

      <div className="grid grid-cols-3 gap-3 pt-5">
        <IngressLink href={`/budget/income?month=${month}`} className="min-w-0">
          <Metric label="Income" valueCents={plannedIncomeCents} link />
        </IngressLink>
        <Metric label="Spent" valueCents={spentCents} />
        <Metric label="Left" valueCents={remainingCents} />
      </div>

      <div className="flex items-center gap-3 pt-4">
        <SegmentedProgress
          spentCents={spentCents}
          plannedCents={plannedExpensesCents}
          className="min-w-0 flex-1"
          aria-label="Spent of monthly plan"
        />
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {pct}% of plan
        </span>
      </div>

      {overPlan && (
        <p className="flex items-center gap-1.5 pt-3 text-sm font-medium text-destructive">
          <TriangleAlert className="size-4" />
          Over plan by {formatCents(spentCents - plannedExpensesCents)}
        </p>
      )}
      {!overPlan && leftToBudgetCents === 0 && (
        <p className="flex items-center gap-1.5 pt-3 text-sm text-muted-foreground">
          <CircleCheck className="size-4 text-primary" />
          You&apos;re on track
        </p>
      )}

      <div className="mt-4 border-t pt-4">
        <p className="text-[11px] font-medium tracking-[0.15em] text-muted-foreground uppercase">
          Left to budget
        </p>
        <div className="flex items-baseline justify-between gap-3 pt-1">
          <p
            className={`font-serif text-2xl tabular-nums ${
              leftToBudgetCents === 0
                ? "text-muted-foreground"
                : leftToBudgetCents > 0
                  ? "text-warning"
                  : "text-destructive"
            }`}
          >
            {formatCents(Math.abs(leftToBudgetCents))}
          </p>
          <p className="text-xs text-muted-foreground">
            {leftToBudgetCents === 0
              ? "every dollar has a job"
              : leftToBudgetCents > 0
                ? "needs a home"
                : "overbudgeted"}
          </p>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  valueCents,
  link = false,
}: {
  label: string;
  valueCents: number;
  link?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium tracking-[0.15em] text-muted-foreground uppercase">
        {label}
        {link && " ›"}
      </p>
      <p className="truncate pt-0.5 text-sm font-medium tabular-nums">
        {formatCents(valueCents)}
      </p>
    </div>
  );
}
