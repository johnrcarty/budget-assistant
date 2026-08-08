import { IngressLink } from "@/components/layout/ingress";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMonthLabel, shiftMonthString } from "@/lib/month";

export function MonthHeader({
  month,
  basePath,
  rightAction,
  backHref,
  backLabel,
}: {
  month: string;
  basePath: string;
  rightAction?: React.ReactNode;
  // Breadcrumb back to a parent page (e.g. Income -> Budget). Carries no
  // month param itself - callers append it so the parent opens on the
  // same month.
  backHref?: string;
  backLabel?: string;
}) {
  return (
    // Sticky so the month nav stays reachable while scrolling a long budget;
    // the border separates it from content sliding underneath.
    <header className="sticky top-0 z-30 border-b bg-background px-4 pt-6 pb-3">
      {/* Match the pages' centered max-w-5xl column so the header contents
          line up with the cards below on wide screens. */}
      <div className="mx-auto w-full max-w-5xl">
        {backHref && (
          <IngressLink
            href={backHref}
            className="mb-1 -ml-1 flex w-fit items-center text-sm font-medium text-muted-foreground"
          >
            <ChevronLeft className="size-4" />
            {backLabel ?? "Back"}
          </IngressLink>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1">
            <MonthNavLink basePath={basePath} month={month} delta={-1}>
              <ChevronLeft className="size-5" />
            </MonthNavLink>
            <h1 className="truncate px-1 font-serif text-lg font-semibold tracking-[0.04em] uppercase sm:text-xl sm:tracking-[0.08em]">
              {formatMonthLabel(month)}
            </h1>
            <MonthNavLink basePath={basePath} month={month} delta={1}>
              <ChevronRight className="size-5" />
            </MonthNavLink>
          </div>
          {rightAction}
        </div>
      </div>
    </header>
  );
}

function MonthNavLink({
  basePath,
  month,
  delta,
  children,
}: {
  basePath: string;
  month: string;
  delta: number;
  children: React.ReactNode;
}) {
  return (
    <IngressLink
      href={`${basePath}?month=${shiftMonthString(month, delta)}`}
      aria-label={delta < 0 ? "Previous month" : "Next month"}
      className="flex size-8 shrink-0 items-center justify-center text-muted-foreground"
    >
      {children}
    </IngressLink>
  );
}
