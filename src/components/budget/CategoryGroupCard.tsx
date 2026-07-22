import { Card, CardContent } from "@/components/ui/card";
import { archiveCategoryGroup } from "@/server/actions/category-groups";
import { formatCents } from "@/server/lib/money";
import { AddLineItemDialog } from "./AddLineItemDialog";
import { LineItemRow } from "./LineItemRow";
import { CategoryIcon } from "./category-icons";
import { amountForMode, type DisplayMode } from "./display-mode";
import type { budgetLineItems, categoryGroups } from "@/server/db/schema";

export function CategoryGroupCard({
  group,
  month,
  mode,
}: {
  group: typeof categoryGroups.$inferSelect & {
    items: (typeof budgetLineItems.$inferSelect & { spentCents: number })[];
  };
  month: string;
  mode: DisplayMode;
}) {
  // The app-managed Debt section is a system default (like Income): it
  // wears the liability color rather than brand green, and has no Add Item
  // or Archive - its items exist only through debt-account linking.
  const isDebtGroup = group.systemKey === "debt";

  // Group total follows the active Planned/Spent/Remaining mode, same math
  // as the item rows.
  const totalCents = group.items.reduce(
    (sum, item) => sum + amountForMode(item.plannedAmountCents, item.spentCents, mode),
    0,
  );

  return (
    <Card>
      <CardContent>
        <div className="flex items-center justify-between gap-3 pb-2">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                isDebtGroup ? "bg-destructive/10" : "bg-muted"
              }`}
            >
              <CategoryIcon
                name={group.name}
                storedIcon={group.icon}
                className={`size-4 ${isDebtGroup ? "text-destructive" : "text-primary"}`}
              />
            </div>
            <h2 className="truncate text-lg font-bold">{group.name}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {group.items.length > 0 && (
              <span className="font-semibold">{formatCents(totalCents)}</span>
            )}
            {!isDebtGroup && (
              <form action={archiveCategoryGroup.bind(null, group.id)}>
                <button
                  type="submit"
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Archive
                </button>
              </form>
            )}
          </div>
        </div>

        {group.items.length === 0 && (
          <p className="py-2 text-sm text-muted-foreground">No items</p>
        )}

        {group.items.map((item) => (
          <LineItemRow key={item.id} item={item} month={month} mode={mode} />
        ))}

        {!isDebtGroup && (
          <div className="pt-3">
            <AddLineItemDialog categoryGroupId={group.id} month={month} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
