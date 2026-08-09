import { IngressLink } from "@/components/layout/ingress";
import { formatCents } from "@/server/lib/money";
import { formatDueDate } from "@/lib/month";
import { amountForMode, type DisplayMode } from "./display-mode";
import type { BudgetGroupItem } from "@/server/db/queries/budget";

export function LineItemRow({
  item,
  month,
  mode,
}: {
  item: BudgetGroupItem;
  month: string;
  mode: DisplayMode;
}) {
  const amountCents = amountForMode(item.plannedAmountCents, item.spentCents, mode);

  // Projected debt rows have no instance yet - opening one materializes it
  // first, then lands on the ordinary detail page.
  const href = item.id
    ? `/budget/item/${item.id}`
    : `/budget/item/debt/${item.templateId}?month=${month}`;

  return (
    <IngressLink
      href={href}
      className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{item.name}</div>
        {item.dueDay && (
          <div className="text-xs text-muted-foreground">
            {formatDueDate(month, item.dueDay)}
          </div>
        )}
      </div>
      <div className="shrink-0 text-sm font-medium tabular-nums">
        {formatCents(amountCents)}
      </div>
    </IngressLink>
  );
}
