import { getCurrentHousehold } from "@/server/lib/dal";
import { getBudgetOverview } from "@/server/db/queries/budget";
import { currentMonthString } from "@/lib/month";
import { formatCents } from "@/server/lib/money";
import { MonthHeader } from "@/components/budget/MonthHeader";
import { AddIncomeItemDialog } from "@/components/budget/AddIncomeItemDialog";
import { Card, CardContent } from "@/components/ui/card";
import { deleteIncomeItem } from "@/server/actions/income-items";

export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const month = params.month ?? currentMonthString();

  const householdId = await getCurrentHousehold();
  const overview = await getBudgetOverview(householdId, month);

  return (
    <div>
      <MonthHeader month={month} basePath="/budget/income" />

      <div className="p-4">
        <Card className="mb-4">
          <CardContent>
            <div className="text-sm text-muted-foreground">Planned Income</div>
            <div className="text-2xl font-bold">
              {formatCents(overview.plannedIncomeCents)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <div className="flex items-center justify-between pb-2">
              <h2 className="text-lg font-bold">Income</h2>
            </div>

            {overview.income.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between border-b py-3 last:border-b-0"
              >
                <div className="font-medium">{item.name}</div>
                <div className="flex items-center gap-3">
                  <span className="font-medium">
                    {formatCents(item.plannedAmountCents)}
                  </span>
                  <form action={deleteIncomeItem.bind(null, item.id)}>
                    <button
                      type="submit"
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      Remove
                    </button>
                  </form>
                </div>
              </div>
            ))}

            <div className="pt-3">
              <AddIncomeItemDialog month={month} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
