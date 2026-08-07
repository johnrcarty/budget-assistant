import { Card, CardContent } from "@/components/ui/card";
import { archiveCategoryGroup } from "@/server/actions/category-groups";
import { formatCents } from "@/server/lib/money";
import { AddLineItemDialog } from "./AddLineItemDialog";
import { LineItemRow } from "./LineItemRow";
import { CategoryIcon } from "./category-icons";
import { GroupStanding } from "./GroupStanding";
import {
  amountForMode,
  DISPLAY_MODES,
  MODE_COLUMNS_GRID,
  type DisplayMode,
} from "./display-mode";
import type { BudgetGroupItem } from "@/server/db/queries/budget";
import type { categoryGroups } from "@/server/db/schema";

export function CategoryGroupCard({
  group,
  month,
  mode,
}: {
  group: typeof categoryGroups.$inferSelect & { items: BudgetGroupItem[] };
  month: string;
  mode: DisplayMode;
}) {
  // The app-managed Debt section is a system default (like Income): it
  // wears the liability color rather than brand green, and has no Add Item
  // or Archive - its items exist only through debt-account linking.
  const isDebtGroup = group.systemKey === "debt";

  // Group totals follow the same math as the item rows: the active mode's
  // total on mobile, one total per column on desktop.
  const totalCentsFor = (m: DisplayMode) =>
    group.items.reduce(
      (sum, item) => sum + amountForMode(item.plannedAmountCents, item.spentCents, m),
      0,
    );

  const archiveButton = !isDebtGroup && (
    <form action={archiveCategoryGroup.bind(null, group.id)}>
      <button
        type="submit"
        className="text-xs text-muted-foreground hover:text-destructive"
      >
        Archive
      </button>
    </form>
  );

  return (
    <Card>
      <CardContent>
        <GroupStanding
          title={group.name}
          icon={
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
          }
          // Desktop home for Archive - the header's right side is the
          // totals columns there.
          archive={archiveButton}
          mobileSummary={
            <>
              {group.items.length > 0 && (
                <span className="font-semibold">{formatCents(totalCentsFor(mode))}</span>
              )}
              {archiveButton}
            </>
          }
          desktopTotals={DISPLAY_MODES.map((m) => (
            <span key={m} className="hidden text-right font-semibold md:block">
              {group.items.length > 0 ? formatCents(totalCentsFor(m)) : null}
            </span>
          ))}
          items={group.items.map((item) => ({
            id: item.id ?? `projected:${item.templateId}`,
            name: item.name,
            plannedCents: item.plannedAmountCents,
            spentCents: item.spentCents,
          }))}
        />

        {group.items.length > 0 && (
          <div
            className={`hidden border-b pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase ${MODE_COLUMNS_GRID}`}
          >
            <span />
            {DISPLAY_MODES.map((m) => (
              <span key={m} className="text-right">
                {m}
              </span>
            ))}
          </div>
        )}

        {group.items.length === 0 && (
          <p className="py-2 text-sm text-muted-foreground">No items</p>
        )}

        {group.items.map((item) => (
          <LineItemRow
            key={item.id ?? `projected:${item.templateId}`}
            item={item}
            month={month}
            mode={mode}
          />
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
