import Link from "next/link";
import { ChevronRight, CircleAlert } from "lucide-react";

export function NeedsReviewBanner({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <Link
      href="/transactions?uncategorized=1&range=all"
      className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
    >
      <CircleAlert className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="flex-1 font-medium">
        {count} {count === 1 ? "transaction needs" : "transactions need"} review
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
