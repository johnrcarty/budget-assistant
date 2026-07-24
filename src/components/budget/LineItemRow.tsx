import { IngressLink } from "@/components/layout/ingress";
import { formatCents } from "@/server/lib/money";
import { formatDueDate } from "@/lib/month";
import {
  amountForMode,
  DISPLAY_MODES,
  MODE_COLUMNS_GRID,
  type DisplayMode,
} from "./display-mode";
import type { budgetLineItems } from "@/server/db/schema";

export function LineItemRow({
  item,
  month,
  mode,
}: {
  item: typeof budgetLineItems.$inferSelect & { spentCents: number };
  month: string;
  mode: DisplayMode;
}) {
  const amountCents = amountForMode(item.plannedAmountCents, item.spentCents, mode);

  return (
    <IngressLink
      href={`/budget/item/${item.id}`}
      className={`flex items-center justify-between border-b py-3 last:border-b-0 ${MODE_COLUMNS_GRID}`}
    >
      <div>
        <div className="font-medium">{item.name}</div>
        {item.dueDay && (
          <div className="text-sm text-muted-foreground">
            {formatDueDate(month, item.dueDay)}
          </div>
        )}
      </div>
      <div className="font-medium md:hidden">{formatCents(amountCents)}</div>
      {DISPLAY_MODES.map((m) => (
        <div key={m} className="hidden text-right font-medium md:block">
          {formatCents(amountForMode(item.plannedAmountCents, item.spentCents, m))}
        </div>
      ))}
    </IngressLink>
  );
}
