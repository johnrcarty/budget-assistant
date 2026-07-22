import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMonthLabel, shiftMonthString } from "@/lib/month";
import { DISPLAY_MODES, type DisplayMode } from "./display-mode";

export function MonthHeader({
  month,
  basePath,
  mode,
  rightAction,
  backHref,
  backLabel,
}: {
  month: string;
  basePath: string;
  mode?: DisplayMode;
  rightAction?: React.ReactNode;
  // Breadcrumb back to a parent page (e.g. Income -> Budget). Carries no
  // month param itself - callers append it so the parent opens on the
  // same month.
  backHref?: string;
  backLabel?: string;
}) {
  return (
    // Sticky so the month nav and Planned/Spent/Remaining toggle stay
    // reachable while scrolling a long budget. bg-background (vs the
    // page's bg-muted) plus the border gives it visible division from
    // the content sliding underneath.
    <header className="sticky top-0 z-30 border-b bg-background px-4 pt-6 pb-3">
      {backHref && (
        <Link
          href={backHref}
          className="mb-1 -ml-1 flex w-fit items-center text-sm font-medium text-muted-foreground"
        >
          <ChevronLeft className="size-4" />
          {backLabel ?? "Back"}
        </Link>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MonthNavLink basePath={basePath} month={month} delta={-1} mode={mode}>
            <ChevronLeft className="size-6" />
          </MonthNavLink>
          <h1 className="text-2xl font-bold">{formatMonthLabel(month)}</h1>
          <MonthNavLink basePath={basePath} month={month} delta={1} mode={mode}>
            <ChevronRight className="size-6" />
          </MonthNavLink>
        </div>
        {rightAction}
      </div>

      {mode && (
        <div className="mt-4 flex rounded-lg bg-muted p-1 text-sm font-medium">
          {DISPLAY_MODES.map((m) => (
            <Link
              key={m}
              href={`${basePath}?month=${month}&mode=${m}`}
              // Keep the scroll position - switching the display mode
              // re-renders the same list, and jumping to the top loses
              // your place. (Month prev/next still resets, deliberately.)
              scroll={false}
              className={`flex-1 rounded-md py-1.5 text-center capitalize ${
                m === mode ? "bg-secondary text-secondary-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {m}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}

function MonthNavLink({
  basePath,
  month,
  delta,
  mode,
  children,
}: {
  basePath: string;
  month: string;
  delta: number;
  mode?: DisplayMode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`${basePath}?month=${shiftMonthString(month, delta)}${mode ? `&mode=${mode}` : ""}`}
      aria-label={delta < 0 ? "Previous month" : "Next month"}
    >
      {children}
    </Link>
  );
}
