import { getCashflow, type CashflowData } from "@/server/db/queries/cashflow";
import { getCategoryGroups } from "@/server/db/queries/budget";
import { formatCents } from "@/server/lib/money";
import {
  DATE_RANGE_LABELS,
  resolveDateRange,
  type DateRangePreset,
} from "@/lib/date-range";
import {
  buildSankeyGraph,
  CASHFLOW_NODE_ID,
  type SankeyGraphNode,
} from "./sankey-layout";
import { SankeyChart } from "./SankeyChart";

function shareLabel(
  node: SankeyGraphNode,
  data: CashflowData,
  inflowCents: number,
): string | undefined {
  if (node.id === CASHFLOW_NODE_ID) return undefined;
  const pct = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 100) : 0;
  if (node.tier === 0) return `${pct(node.valueCents, inflowCents)}% of inflow`;
  if (node.id === "surplus")
    return `${pct(node.valueCents, data.totalIncomeCents)}% of income`;
  return `${pct(node.valueCents, data.totalExpenseCents)}% of spending`;
}

export async function CashflowSection({
  householdId,
  range,
}: {
  householdId: string;
  range: DateRangePreset;
}) {
  const [data, allGroups] = await Promise.all([
    getCashflow(householdId, resolveDateRange(range)),
    getCategoryGroups(householdId),
  ]);

  if (data.totalIncomeCents === 0 && data.totalExpenseCents === 0) {
    return (
      <div className="rounded-xl bg-card p-4 shadow-xs">
        <CardHeading range={range} />
        <p className="py-12 text-center text-muted-foreground">
          No transactions in this period.
        </p>
      </div>
    );
  }

  // Color follows the entity: a group keeps its slot (assigned from the
  // household's full sortOrder list) no matter which range is shown or which
  // groups happen to have spend in it.
  const groupColors = Object.fromEntries(
    allGroups.map((group, index) => [
      group.id,
      index < 8 ? `var(--chart-${index + 1})` : "var(--muted-foreground)",
    ]),
  );

  const { nodes, links } = buildSankeyGraph(data, groupColors);
  const inflowCents = data.totalIncomeCents + Math.max(0, -data.surplusCents);
  const decoratedNodes = nodes.map((node) => ({
    ...node,
    valueFormatted: formatCents(node.valueCents),
    shareLabel: shareLabel(node, data, inflowCents),
  }));

  const surplus = data.surplusCents;

  return (
    <div className="rounded-xl bg-card p-4 shadow-xs">
      <CardHeading range={range} />
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 pb-2 text-sm text-muted-foreground">
        <span>
          In{" "}
          <span className="font-medium text-foreground">
            {formatCents(data.totalIncomeCents)}
          </span>
        </span>
        <span>
          Out{" "}
          <span className="font-medium text-foreground">
            {formatCents(data.totalExpenseCents)}
          </span>
        </span>
        <span>
          {surplus >= 0 ? "Surplus" : "Deficit"}{" "}
          <span
            className={
              surplus >= 0 ? "font-medium text-primary" : "font-medium text-destructive"
            }
          >
            {formatCents(Math.abs(surplus))}
          </span>
        </span>
      </div>
      <SankeyChart
        nodes={decoratedNodes}
        links={links}
        ariaLabel={`Cash flow for ${DATE_RANGE_LABELS[range].toLowerCase()}: ${formatCents(
          data.totalIncomeCents,
        )} in, ${formatCents(data.totalExpenseCents)} out, ${formatCents(
          Math.abs(surplus),
        )} ${surplus >= 0 ? "surplus" : "deficit"}.`}
      />
    </div>
  );
}

function CardHeading({ range }: { range: DateRangePreset }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="font-semibold">Cash Flow</h2>
      <span className="text-sm text-muted-foreground">{DATE_RANGE_LABELS[range]}</span>
    </div>
  );
}
