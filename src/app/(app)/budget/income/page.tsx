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
            <div className="pt-1 text-sm text-muted-foreground">
              <span
                className={
                  overview.receivedIncomeCents > 0 ? "font-medium text-primary" : ""
                }
              >
                {formatCents(overview.receivedIncomeCents)}
              </span>{" "}
              received so far
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
                <div>
                  <div className="font-medium">{item.name}</div>
                  {item.receivedCents > 0 ? (
                    <div className="text-sm font-medium text-primary">
                      ✓ {formatCents(item.receivedCents)} received
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">expected</div>
                  )}
                </div>
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
            <p className="pt-2 text-xs text-muted-foreground">
              Numbered names like &ldquo;Person A 1&rdquo; / &ldquo;Person A 2&rdquo; are
              treated as paycheck slots for one source - rules fill them in
              deposit order.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
