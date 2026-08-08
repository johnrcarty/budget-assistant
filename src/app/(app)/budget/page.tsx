import { Plus } from "lucide-react";
import { getCurrentHousehold } from "@/server/lib/dal";
import { getBudgetOverview } from "@/server/db/queries/budget";
import { currentDateString, currentMonthString } from "@/lib/month";
import { sumSpentCents } from "@/lib/budget-totals";
import { assembleUpcomingMoney } from "@/lib/upcoming-money";
import { MonthHeader } from "@/components/budget/MonthHeader";
import { BudgetOverview } from "@/components/budget/BudgetOverview";
import { UpcomingMoney } from "@/components/budget/UpcomingMoney";
import { BudgetCategoriesSection } from "@/components/budget/BudgetCategoriesSection";
import { AddLineItemDialog } from "@/components/budget/AddLineItemDialog";
import { AddCategoryGroupDialog } from "@/components/budget/AddCategoryGroupDialog";
import { CreateMonthBudgetPrompt } from "@/components/budget/CreateMonthBudgetPrompt";

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const month = params.month ?? currentMonthString();
  const today = currentDateString();

  const householdId = await getCurrentHousehold();
  const overview = await getBudgetOverview(householdId, month);

  const spentCents = sumSpentCents(overview.groups);
  const { upcoming, monthAll } = assembleUpcomingMoney({
    month,
    today,
    items: overview.groups.flatMap((group) => group.items),
    income: overview.income,
  });

  const addItemGroups = overview.groups
    .filter((group) => group.systemKey !== "debt")
    .map((group) => ({ id: group.id, name: group.name, icon: group.icon }));

  return (
    <div>
      <MonthHeader
        month={month}
        basePath="/budget"
        rightAction={
          addItemGroups.length > 0 ? (
            <AddLineItemDialog
              month={month}
              groups={addItemGroups}
              triggerClassName="flex shrink-0 items-center gap-1.5 rounded-full border border-primary px-3 py-1.5 text-sm font-medium text-primary"
              triggerContent={
                <>
                  <Plus className="size-4" />
                  Add Item
                </>
              }
            />
          ) : (
            <AddCategoryGroupDialog />
          )
        }
      />

      {!overview.hasBudget && overview.previousMonthWithBudget ? (
        <CreateMonthBudgetPrompt
          month={month}
          previousMonth={overview.previousMonthWithBudget.month}
        />
      ) : (
        <div className="mx-auto w-full max-w-5xl p-4">
          <div className="flex flex-col gap-6 md:grid md:grid-cols-2 md:items-start md:gap-4">
            <BudgetOverview
              plannedIncomeCents={overview.plannedIncomeCents}
              plannedExpensesCents={overview.plannedExpensesCents}
              spentCents={spentCents}
              leftToBudgetCents={overview.leftToBudgetCents}
              month={month}
            />
            <UpcomingMoney upcoming={upcoming} monthAll={monthAll} />
          </div>

          <div className="pt-6">
            <BudgetCategoriesSection
              month={month}
              groups={overview.groups.map((group) => ({
                id: group.id,
                name: group.name,
                icon: group.icon,
                systemKey: group.systemKey,
                items: group.items,
              }))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
