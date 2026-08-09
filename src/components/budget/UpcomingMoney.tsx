import { IngressLink } from "@/components/layout/ingress";
import { formatCents } from "@/server/lib/money";
import { shortDateLabel, type UpcomingEntry } from "@/lib/upcoming-money";
import { UpcomingMoneyDialog } from "./UpcomingMoneyDialog";

// What money is moving next: dated bills and paydays, chronologically,
// without expanding any category.
export function UpcomingMoney({
  upcoming,
  monthAll,
}: {
  upcoming: UpcomingEntry[];
  monthAll: UpcomingEntry[];
}) {
  if (monthAll.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between pb-2">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Coming Up
        </h2>
        <UpcomingMoneyDialog entries={monthAll} />
      </div>

      {upcoming.length === 0 ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Nothing left on the calendar this month.
        </p>
      ) : (
        <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {upcoming.map((entry) => {
            const body = (
              <>
                <span className="text-[10px] font-medium tracking-[0.15em] text-muted-foreground uppercase">
                  {shortDateLabel(entry.date)}
                </span>
                <span
                  className={`pt-1 font-serif text-base tabular-nums ${
                    entry.kind === "income" ? "text-primary" : "text-foreground"
                  }`}
                >
                  {entry.kind === "income" ? "+" : ""}
                  {formatCents(entry.amountCents)}
                </span>
                <span className="truncate pt-0.5 text-xs text-muted-foreground">
                  {entry.name}
                </span>
              </>
            );
            const cardClass =
              "flex w-32 shrink-0 snap-start flex-col rounded-lg border bg-card p-3";
            return entry.href ? (
              <IngressLink key={entry.key} href={entry.href} className={cardClass}>
                {body}
              </IngressLink>
            ) : (
              <div key={entry.key} className={cardClass}>
                {body}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
