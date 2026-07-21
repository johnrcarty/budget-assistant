import { CalendarPlus } from "lucide-react";
import { copyPreviousMonthBudget } from "@/server/actions/budget-month";
import { formatMonthShort } from "@/lib/month";

export function CreateMonthBudgetPrompt({
  month,
  previousMonth,
}: {
  month: string;
  previousMonth: string;
}) {
  const monthLabel = formatMonthShort(month);
  const previousMonthLabel = formatMonthShort(previousMonth);

  return (
    <div className="flex flex-col items-center gap-6 px-6 py-16 text-center">
      <CalendarPlus className="size-24 text-brand" strokeWidth={1.5} />
      <div>
        <h2 className="text-2xl font-bold">
          Let&rsquo;s create your {monthLabel} budget.
        </h2>
        <p className="mt-2 text-muted-foreground">
          We&rsquo;ll copy {previousMonthLabel}&rsquo;s budget to get you
          started.
        </p>
      </div>
      <form
        action={copyPreviousMonthBudget.bind(null, month)}
        className="w-full max-w-xs"
      >
        <button
          type="submit"
          className="w-full rounded-lg bg-primary py-4 font-bold text-primary-foreground"
        >
          Create {monthLabel} Budget
        </button>
      </form>
    </div>
  );
}
