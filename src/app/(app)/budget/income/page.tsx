import { getCurrentHousehold } from "@/server/lib/dal";
import { getBudgetOverview } from "@/server/db/queries/budget";
import {
  getActiveIncomeTemplates,
  getIncomeSchedules,
} from "@/server/db/queries/income-schedules";
import { currentDateString, currentMonthString } from "@/lib/month";
import { buildSlotGroups, incomeSlotGroupKey, incomeSlotGroupLabel } from "@/lib/income-slots";
import { formatCents } from "@/server/lib/money";
import { MonthHeader } from "@/components/budget/MonthHeader";
import { AddIncomeItemDialog } from "@/components/budget/AddIncomeItemDialog";
import { IncomeSourceCard } from "@/components/budget/IncomeSourceCard";
import { Card, CardContent } from "@/components/ui/card";
import { deleteIncomeItem } from "@/server/actions/income-items";

export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const month = params.month ?? currentMonthString();
  const today = currentDateString();

  const householdId = await getCurrentHousehold();
  const [overview, templates, schedules] = await Promise.all([
    getBudgetOverview(householdId, month),
    getActiveIncomeTemplates(householdId),
    getIncomeSchedules(householdId),
  ]);

  const scheduleByKey = new Map(schedules.map((s) => [s.groupKey, s]));
  const templateAmountById = new Map(templates.map((t) => [t.id, t.defaultAmountCents]));
  const slotGroups = buildSlotGroups(templates);

  // A "person" is any multi-slot group or any group with a pay schedule;
  // singleton unscheduled items ("Bonus") stay in the flat list below.
  const personGroups = [...slotGroups.entries()].filter(
    ([key, members]) => members.length > 1 || scheduleByKey.has(key),
  );
  const personKeys = new Set(personGroups.map(([key]) => key));

  const itemsByGroup = new Map<string, typeof overview.income>();
  const otherItems: typeof overview.income = [];
  for (const item of overview.income) {
    const key = incomeSlotGroupKey(item.name);
    if (personKeys.has(key)) {
      const list = itemsByGroup.get(key) ?? [];
      list.push(item);
      itemsByGroup.set(key, list);
    } else {
      otherItems.push(item);
    }
  }

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

        {personGroups.map(([key, members]) => {
          const schedule = scheduleByKey.get(key) ?? null;
          const items = (itemsByGroup.get(key) ?? []).sort((a, b) =>
            a.expectedDate && b.expectedDate
              ? a.expectedDate.localeCompare(b.expectedDate)
              : a.sortOrder - b.sortOrder,
          );
          return (
            <IncomeSourceCard
              key={key}
              groupKey={key}
              groupLabel={incomeSlotGroupLabel(members[0].name)}
              schedule={schedule}
              perCheckAmountCents={
                schedule?.perCheckAmountCents ||
                templateAmountById.get(members[0].id) ||
                0
              }
              items={items}
              month={month}
              today={today}
            />
          );
        })}

        <Card>
          <CardContent>
            <div className="flex items-center justify-between pb-2">
              <h2 className="text-lg font-bold">Other income</h2>
            </div>

            {otherItems.length === 0 && (
              <p className="py-2 text-sm text-muted-foreground">
                One-off income like bonuses or refunds lands here.
              </p>
            )}
            {otherItems.map((item) => (
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
