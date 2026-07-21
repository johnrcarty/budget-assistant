import Link from "next/link";
import { getCurrentHousehold } from "@/server/lib/dal";
import { getDebtPlanData } from "@/server/db/queries/debt-plan";
import { linkDebtToBudget } from "@/server/actions/debt-plan";
import { formatCents } from "@/server/lib/money";
import { formatMonthLabel } from "@/lib/month";
import { AppHeader } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/button";
import { DebtPlanControls } from "@/components/debt/DebtPlanControls";
import { BurnDownChart } from "@/components/debt/BurnDownChart";
import type { BurnDownDebt, BurnDownPoint } from "@/components/debt/burn-down-layout";
import type { SimulatedDebt, SimWarning } from "@/server/lib/debt-sim";

const MAX_PROJECTED_POINTS = 120; // ~10 years on the chart

const monthLabel = (month: string) => formatMonthLabel(month);

export default async function DebtPage() {
  const householdId = await getCurrentHousehold();
  const data = await getDebtPlanData(householdId);
  const { sim, settings, history, linkedByAccount } = data;
  const accountById = new Map(data.accounts.map((a) => [a.id, a]));

  if (data.accounts.length === 0) {
    return (
      <div>
        <AppHeader title="Debt Payoff" backHref="/more" />
        <div className="px-4 pt-8 text-center text-muted-foreground">
          <p>No debt accounts yet.</p>
          <Link href="/accounts" className="mt-2 inline-block font-medium text-primary">
            Add one in Accounts →
          </Link>
        </div>
      </div>
    );
  }

  // Color follows the entity: simulated debts get chart slots in strategy
  // order; excluded debts render muted.
  const colorByAccount = new Map<string, string>();
  sim.order.forEach((accountId, index) => {
    colorByAccount.set(
      accountId,
      index < 8 ? `var(--chart-${index + 1})` : "var(--muted-foreground)",
    );
  });

  const simulated = sim.debts.filter((d) => d.status === "simulated");
  const excludedWithBalance = sim.debts.filter(
    (d) =>
      (d.status === "needs_terms" || d.status === "negative_amortization") &&
      d.startingBalanceCents > 0,
  );
  const conquered = sim.debts.filter((d) => d.status === "paid_off");
  const totalDebtCents = sim.debts.reduce((sum, d) => sum + d.startingBalanceCents, 0);

  // Chart series: solid history from snapshots, then the simulator timeline
  // as the projected path. Debts the simulator excluded keep their last
  // known balance flat through the projection - they don't vanish, they're
  // just not being paid down by the plan (the warnings explain why).
  const excludedFlatCents = Object.fromEntries(
    excludedWithBalance.map((d) => [d.accountId, d.startingBalanceCents]),
  );
  const excludedTotal = excludedWithBalance.reduce((s, d) => s + d.startingBalanceCents, 0);

  const chartPoints: BurnDownPoint[] = [
    ...history.map((point) => ({
      label: monthLabel(`${point.date.slice(0, 7)}-01`),
      totalFormatted: formatCents(point.totalCents),
      totalCents: point.totalCents,
      perDebtCents: point.perDebtCents,
      projected: false,
    })),
    ...sim.timeline.slice(1, 1 + MAX_PROJECTED_POINTS).map((point) => ({
      label: monthLabel(point.month),
      totalFormatted: formatCents(point.totalCents + excludedTotal),
      totalCents: point.totalCents + excludedTotal,
      perDebtCents: { ...point.perDebtCents, ...excludedFlatCents },
      projected: true,
    })),
  ];
  const projectionTruncated = sim.timeline.length - 1 > MAX_PROJECTED_POINTS;

  const chartDebts: BurnDownDebt[] = [
    ...sim.order.map((accountId) => ({
      accountId,
      label: accountById.get(accountId)?.name ?? "",
      color: colorByAccount.get(accountId) ?? "var(--muted-foreground)",
    })),
    ...excludedWithBalance.map((d) => ({
      accountId: d.accountId,
      label: d.name,
      color: "var(--muted-foreground)",
    })),
  ];

  return (
    <div>
      <AppHeader title="Debt Payoff" backHref="/more" />
      <div className="flex flex-col gap-4 px-4 pb-4">
        <div className="grid grid-cols-3 gap-3">
          <HeroStat label="Total debt" value={formatCents(totalDebtCents)} />
          <HeroStat
            label="Debt-free"
            value={sim.debtFreeMonth ? monthLabel(sim.debtFreeMonth) : "—"}
          />
          <HeroStat
            label="Monthly commitment"
            value={formatCents(sim.monthlyCommitmentCents)}
          />
        </div>

        <div className="rounded-xl bg-card p-4 shadow-xs">
          <h2 className="pb-3 font-semibold">Strategy</h2>
          <DebtPlanControls
            strategy={settings.strategy}
            extraMonthlyCents={settings.extraMonthlyCents}
          />
        </div>

        {chartPoints.length >= 2 && (
          <div className="rounded-xl bg-card p-4 shadow-xs">
            <div className="flex items-baseline justify-between pb-2">
              <h2 className="font-semibold">Burn-down</h2>
              {projectionTruncated && (
                <span className="text-xs text-muted-foreground">first 10 years shown</span>
              )}
            </div>
            <BurnDownChart
              points={chartPoints}
              debts={chartDebts}
              ariaLabel={`Debt balances over time: ${formatCents(totalDebtCents)} today${
                sim.debtFreeMonth ? `, projected debt-free ${monthLabel(sim.debtFreeMonth)}` : ""
              }.`}
            />
          </div>
        )}

        {sim.interestSavedCents !== null && sim.monthsSooner !== null ? (
          (sim.interestSavedCents > 0 || sim.monthsSooner > 0) && (
            <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm">
              This plan saves about{" "}
              <span className="font-semibold">{formatCents(sim.interestSavedCents)}</span> in
              interest and gets you debt-free{" "}
              <span className="font-semibold">
                {sim.monthsSooner} {sim.monthsSooner === 1 ? "month" : "months"} sooner
              </span>{" "}
              than paying minimums only.
            </div>
          )
        ) : (
          sim.debtFreeMonth && (
            <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm">
              This plan pays everything off — minimum payments alone never would.
            </div>
          )
        )}

        <Warnings warnings={sim.warnings} accountNames={new Map(sim.debts.map((d) => [d.accountId, d.name]))} />

        <div className="rounded-xl bg-card p-4 shadow-xs">
          <h2 className="pb-1 font-semibold">Payoff order</h2>
          <p className="pb-2 text-xs text-muted-foreground">
            {settings.strategy === "snowball"
              ? "Smallest balance first; each payoff rolls into the next debt."
              : "Highest rate first; each payoff rolls into the next debt."}
          </p>
          {simulated.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No debts can be simulated yet — add terms to your debts below.
            </p>
          ) : (
            simulated.map((debt, index) => (
              <DebtRow
                key={debt.accountId}
                debt={debt}
                isTarget={index === 0}
                color={colorByAccount.get(debt.accountId) ?? "var(--muted-foreground)"}
                originalBalanceCents={accountById.get(debt.accountId)?.originalBalanceCents ?? null}
                linked={linkedByAccount.get(debt.accountId)}
              />
            ))
          )}
          {excludedWithBalance.map((debt) => (
            <DebtRow
              key={debt.accountId}
              debt={debt}
              isTarget={false}
              color="var(--muted-foreground)"
              originalBalanceCents={accountById.get(debt.accountId)?.originalBalanceCents ?? null}
              linked={linkedByAccount.get(debt.accountId)}
            />
          ))}
        </div>

        {conquered.length > 0 && (
          <div className="rounded-xl bg-card p-4 shadow-xs">
            <h2 className="pb-2 font-semibold">Conquered 🎉</h2>
            {conquered.map((debt) => {
              const linked = linkedByAccount.get(debt.accountId);
              return (
                <div
                  key={debt.accountId}
                  className="flex items-center justify-between border-b py-2 text-sm last:border-b-0"
                >
                  <span className="font-medium">{debt.name}</span>
                  <span className="text-muted-foreground">
                    {linked?.isActive
                      ? "Still budgeted — unlink it or raise your extra payment"
                      : "Paid off"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-card p-3 shadow-xs">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="pt-1 text-sm font-semibold sm:text-base">{value}</div>
    </div>
  );
}

const WARNING_TEXT: Record<SimWarning["kind"], (name: string) => string> = {
  needs_terms: (name) => `${name} needs terms (APR and payment) before it can join the plan.`,
  negative_amortization: (name) =>
    `${name}'s payment doesn't cover its interest — the balance won't go down. Increase the payment.`,
  budget_below_minimum: (name) =>
    `${name} is budgeted below its minimum payment; the plan assumes the minimum gets paid.`,
  promo_ends: (name) => `${name} has a promo rate ending soon; the projection assumes the current APR.`,
  capped: (name) => `${name} won't be paid off within 50 years at current payments.`,
};

function Warnings({
  warnings,
  accountNames,
}: {
  warnings: SimWarning[];
  accountNames: Map<string, string>;
}) {
  if (warnings.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
      <ul className="flex flex-col gap-1 text-sm">
        {warnings.map((warning, i) => (
          <li key={`${warning.accountId}-${warning.kind}-${i}`}>
            {WARNING_TEXT[warning.kind](accountNames.get(warning.accountId) ?? "A debt")}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DebtRow({
  debt,
  isTarget,
  color,
  originalBalanceCents,
  linked,
}: {
  debt: SimulatedDebt;
  isTarget: boolean;
  color: string;
  originalBalanceCents: number | null;
  linked: { isActive: boolean; plannedMonthlyCents: number } | undefined;
}) {
  const progress =
    originalBalanceCents && originalBalanceCents > 0
      ? Math.max(0, Math.min(1, 1 - debt.startingBalanceCents / originalBalanceCents))
      : null;

  return (
    <div
      className={`-mx-2 mb-2 rounded-lg px-2 py-2.5 ${
        isTarget ? "bg-primary/5 ring-1 ring-primary/40" : "border-b last:border-b-0"
      }`}
    >
      <Link href={`/accounts/${debt.accountId}`} className="block">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="truncate font-medium">{debt.name}</span>
            {isTarget && (
              <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                Focus
              </span>
            )}
          </div>
          <span className="shrink-0 font-medium">
            {formatCents(debt.startingBalanceCents)}
          </span>
        </div>
        <div className="flex items-center justify-between pt-1 text-sm text-muted-foreground">
          <span>
            {debt.status === "simulated" && debt.payoffMonth
              ? `Paid off ${formatMonthLabel(debt.payoffMonth)}`
              : debt.status === "needs_terms"
                ? "Needs terms"
                : debt.status === "negative_amortization"
                  ? "Payment too low"
                  : "—"}
          </span>
          {linked?.isActive && <span>{formatCents(linked.plannedMonthlyCents)}/mo budgeted</span>}
        </div>
        {progress !== null && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.round(progress * 100)}%`, backgroundColor: color }}
            />
          </div>
        )}
      </Link>
      {!linked?.isActive && (
        <form action={linkDebtToBudget.bind(null, debt.accountId)} className="pt-2">
          <Button type="submit" variant="outline" size="sm">
            Add to budget
          </Button>
        </form>
      )}
    </div>
  );
}
