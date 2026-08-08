"use client";

import { Check } from "lucide-react";
import { IngressLink } from "@/components/layout/ingress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatCents } from "@/server/lib/money";
import { shortDateLabel, type UpcomingEntry } from "@/lib/upcoming-money";

// Full chronological list of the month's dated money movement, settled
// entries included (muted, checked).
export function UpcomingMoneyDialog({ entries }: { entries: UpcomingEntry[] }) {
  return (
    <Dialog>
      <DialogTrigger className="text-xs font-medium text-primary">
        View all
      </DialogTrigger>
      <DialogContent className="max-h-[80svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>This Month&apos;s Schedule</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col">
          {entries.map((entry) => {
            const row = (
              <>
                <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {shortDateLabel(entry.date)}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-sm ${
                    entry.settled ? "text-muted-foreground line-through" : ""
                  }`}
                >
                  {entry.name}
                </span>
                {entry.settled && (
                  <Check className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={`shrink-0 text-sm font-medium tabular-nums ${
                    entry.settled
                      ? "text-muted-foreground"
                      : entry.kind === "income"
                        ? "text-primary"
                        : ""
                  }`}
                >
                  {entry.kind === "income" ? "+" : ""}
                  {formatCents(entry.amountCents)}
                </span>
              </>
            );
            const rowClass =
              "flex items-center gap-3 border-b py-2.5 last:border-b-0";
            return entry.href ? (
              <IngressLink key={entry.key} href={entry.href} className={rowClass}>
                {row}
              </IngressLink>
            ) : (
              <div key={entry.key} className={rowClass}>
                {row}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
