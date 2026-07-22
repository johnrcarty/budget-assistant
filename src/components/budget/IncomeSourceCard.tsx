import { Card, CardContent } from "@/components/ui/card";
import { formatCents } from "@/server/lib/money";
import { formatFullDate } from "@/lib/month";
import {
  checkDatesInMonth,
  checksPerYear,
  diffIsoDays,
  frequencyLabel,
  upcomingCheckDates,
  type PayFrequency,
  type ScheduleSpec,
} from "@/lib/income-schedule";
import type { IncomeSchedule } from "@/server/db/queries/income-schedules";
import {
  EditIncomeScheduleDialog,
  type ScheduleInitialValues,
} from "@/components/budget/EditIncomeScheduleDialog";
import { deleteIncomeItem } from "@/server/actions/income-items";

export interface IncomeCardItem {
  id: string;
  name: string;
  plannedAmountCents: number;
  expectedDate: string | null;
  receivedCents: number;
}

function relativeLabel(today: string, date: string): string {
  const days = diffIsoDays(today, date);
  if (days === 0) return "today";
  if (days === 1) return "in 1 day";
  if (days > 1) return `in ${days} days`;
  return days === -1 ? "1 day ago" : `${-days} days ago`;
}

export function IncomeSourceCard({
  groupKey,
  groupLabel,
  schedule,
  perCheckAmountCents,
  items,
  month,
  today,
}: {
  groupKey: string;
  groupLabel: string;
  schedule: IncomeSchedule | null;
  perCheckAmountCents: number;
  items: IncomeCardItem[];
  month: string;
  today: string;
}) {
  const spec: ScheduleSpec | null = schedule
    ? {
        frequency: schedule.frequency as PayFrequency,
        anchorDate: schedule.anchorDate,
        secondDayOfMonth: schedule.secondDayOfMonth,
      }
    : null;
  const perYear = spec ? checksPerYear(spec.frequency) : null;
  const checksThisMonth = spec ? checkDatesInMonth(spec, month).length : items.length;
  const upcoming = spec ? upcomingCheckDates(spec, today, 3) : [];

  const initial: ScheduleInitialValues | undefined = schedule
    ? {
        frequency: schedule.frequency as PayFrequency,
        anchorDate: schedule.anchorDate,
        secondDayOfMonth: schedule.secondDayOfMonth,
        perCheckAmount: (schedule.perCheckAmountCents / 100).toFixed(2),
      }
    : {
        frequency: "biweekly",
        anchorDate: null,
        secondDayOfMonth: null,
        perCheckAmount: (perCheckAmountCents / 100).toFixed(2),
      };

  return (
    <Card className="mb-4">
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/15 font-bold text-primary">
              {groupLabel.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="font-bold">{groupLabel}</div>
              <div className="text-sm text-muted-foreground">
                {spec ? frequencyLabel(spec.frequency) : "No schedule"}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-primary">
              {formatCents(perCheckAmountCents)}
            </div>
            <div className="text-xs text-muted-foreground">per check</div>
          </div>
        </div>

        {spec && (
          <div className="flex gap-4 border-b py-3 text-sm text-muted-foreground">
            {perYear !== null && <span>{perYear} checks / year</span>}
            <span>
              {checksThisMonth} this month
            </span>
            {upcoming[0] && <span>next {formatFullDate(upcoming[0])}</span>}
          </div>
        )}

        {items.length > 0 && (
          <div>
            <div className="pt-3 text-sm font-medium">This month</div>
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between border-b py-3 last:border-b-0"
              >
                <div>
                  <div className="font-medium">
                    {item.expectedDate ? formatFullDate(item.expectedDate) : item.name}
                  </div>
                  {item.receivedCents > 0 ? (
                    <div className="text-sm font-medium text-primary">
                      ✓ {formatCents(item.receivedCents)} received
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {item.expectedDate
                        ? `expected ${relativeLabel(today, item.expectedDate)}`
                        : "expected"}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium">{formatCents(item.plannedAmountCents)}</span>
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
          </div>
        )}

        {upcoming.length > 0 && (
          <div>
            <div className="pt-3 text-sm font-medium">Upcoming checks</div>
            {upcoming.map((date) => (
              <div
                key={date}
                className="flex items-center justify-between border-b py-2 text-sm last:border-b-0"
              >
                <span>
                  {formatFullDate(date)}{" "}
                  <span className="text-muted-foreground">({relativeLabel(today, date)})</span>
                </span>
                <span className="font-medium">{formatCents(perCheckAmountCents)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="pt-3">
          <EditIncomeScheduleDialog
            groupKey={groupKey}
            groupLabel={groupLabel}
            month={month}
            initial={initial}
            triggerClassName="text-sm font-medium text-primary"
            trigger={schedule ? "Edit schedule" : "Set up schedule"}
          />
        </div>
      </CardContent>
    </Card>
  );
}
