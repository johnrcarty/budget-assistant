import { notFound } from "next/navigation";
import { getCurrentHousehold } from "@/server/lib/dal";
import { getLineItemDetail, getCategoryGroups } from "@/server/db/queries/budget";
import {
  getSpentCentsByLineItem,
  getTransactionsForLineItem,
} from "@/server/db/queries/transactions";
import { formatCents } from "@/server/lib/money";
import { formatMonthShort } from "@/lib/month";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card, CardContent } from "@/components/ui/card";
import { LineItemDetailForm } from "@/components/budget/LineItemDetailForm";

export default async function LineItemDetailPage({
  params,
}: {
  params: Promise<{ lineItemId: string }>;
}) {
  const { lineItemId } = await params;
  const householdId = await getCurrentHousehold();
  const row = await getLineItemDetail(householdId, lineItemId);

  if (!row) notFound();

  const { item, month } = row;
  const [spentByItem, itemTransactions, categoryGroupList] = await Promise.all([
    getSpentCentsByLineItem([item.id]),
    getTransactionsForLineItem(item.id),
    getCategoryGroups(householdId),
  ]);
  const spentCents = spentByItem.get(item.id) ?? 0;
  const remainingCents = item.plannedAmountCents - spentCents;

  return (
    <div>
      <AppHeader title={item.name} backHref={`/budget?month=${month}`} />

      <div className="flex flex-col gap-4 px-4 pb-4">
        <Card>
          <CardContent className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {formatCents(spentCents)} spent of {formatCents(item.plannedAmountCents)}
            </span>
            <span className="text-right">
              <div className="text-xs tracking-wide text-muted-foreground uppercase">
                Remaining
              </div>
              <div className="text-2xl font-bold text-primary">
                {formatCents(remainingCents)}
              </div>
            </span>
          </CardContent>
        </Card>

        <LineItemDetailForm item={item} categoryGroupList={categoryGroupList} />

        <Card>
          <CardContent>
            <h2 className="pb-2 font-bold">Activity This Month</h2>
            <div className="flex items-center justify-between border-b py-2 text-sm">
              <span className="text-muted-foreground">
                {formatMonthShort(month)} 1
              </span>
              <span>Planned This Month</span>
              <span className="font-medium text-primary">
                +{formatCents(item.plannedAmountCents)}
              </span>
            </div>
            {itemTransactions.map((txn) => (
              <div
                key={txn.id}
                className="flex items-center justify-between border-b py-2 text-sm"
              >
                <span className="text-muted-foreground">
                  {new Date(txn.postedDate).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  })}
                </span>
                <span>{txn.description}</span>
                <span
                  className={
                    txn.amountCents < 0 ? "font-medium" : "font-medium text-primary"
                  }
                >
                  {formatCents(txn.amountCents)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-end pt-2 text-sm font-medium">
              {formatCents(remainingCents)} Remaining
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
