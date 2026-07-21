import { Card, CardContent } from "@/components/ui/card";
import { archiveCategoryGroup } from "@/server/actions/category-groups";
import { AddLineItemDialog } from "./AddLineItemDialog";
import { LineItemRow } from "./LineItemRow";
import { CategoryIcon } from "./category-icons";
import type { DisplayMode } from "./display-mode";
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
  return (
    <Card>
      <CardContent>
        <div className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-muted">
              <CategoryIcon
                name={group.name}
                storedIcon={group.icon}
                className="size-4 text-primary"
              />
            </div>
            <h2 className="text-lg font-bold">{group.name}</h2>
          </div>
          <form action={archiveCategoryGroup.bind(null, group.id)}>
            <button
              type="submit"
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              Archive
            </button>
          </form>
        </div>

        {group.items.length === 0 && (
          <p className="py-2 text-sm text-muted-foreground">No items</p>
        )}

        {group.items.map((item) => (
          <LineItemRow key={item.id} item={item} month={month} mode={mode} />
        ))}

        <div className="pt-3">
          <AddLineItemDialog categoryGroupId={group.id} month={month} />
        </div>
      </CardContent>
    </Card>
  );
}
