import { Suspense } from "react";
import { getCurrentHousehold } from "@/server/lib/dal";
import { getUncategorizedCount } from "@/server/db/queries/transactions";
import { getBudgetOverview, getUpcomingBills } from "@/server/db/queries/budget";
import { currentDateString, currentMonthString } from "@/lib/month";
import { isDateRangePreset, type DateRangePreset } from "@/lib/date-range";
import { AppHeader } from "@/components/layout/AppHeader";
import { CashflowSection } from "@/components/summary/CashflowSection";
import { MonthStatusCard } from "@/components/summary/MonthStatusCard";
import { NeedsReviewBanner } from "@/components/summary/NeedsReviewBanner";
import { RangeChips } from "@/components/summary/RangeChips";
import { UpcomingBillsCard } from "@/components/summary/UpcomingBillsCard";

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  // "month" is a valid preset elsewhere but not offered here - the month
  // status card already covers it.
  const range: DateRangePreset =
    isDateRangePreset(params.range) && params.range !== "month" ? params.range : "30d";

  const householdId = await getCurrentHousehold();
  const month = currentMonthString();

  const [uncategorizedCount, bills, overview] = await Promise.all([
    getUncategorizedCount(householdId),
    getUpcomingBills(householdId, currentDateString()),
    getBudgetOverview(householdId, month),
  ]);

  return (
    <div>
      <AppHeader title="Summary" />
      <div className="flex flex-col gap-4 px-4 pb-4">
        <NeedsReviewBanner count={uncategorizedCount} />
        <RangeChips active={range} />
        <Suspense key={range} fallback={<SankeySkeleton />}>
          <CashflowSection householdId={householdId} range={range} />
        </Suspense>
        <div className="grid gap-4 md:grid-cols-2">
          <UpcomingBillsCard bills={bills} />
          <MonthStatusCard overview={overview} month={month} />
        </div>
      </div>
    </div>
  );
}

function SankeySkeleton() {
  return (
    <div className="rounded-xl bg-card p-4 shadow-xs">
      <div className="h-5 w-24 animate-pulse rounded bg-muted" />
      <div className="mt-3 h-[400px] animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
