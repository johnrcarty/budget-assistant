import { TriangleAlert } from "lucide-react";

// "Go reconnect this at SimpleFin" marker for an account whose institution
// SimpleFin says needs attention. The raw message is the tooltip; the
// visible text stays short and tells the user what to do.
export function SyncIssueBadge({
  issue,
  size = "sm",
}: {
  issue: string | null | undefined;
  size?: "sm" | "xs";
}) {
  if (!issue) return null;
  return (
    <div
      className={`flex items-center gap-1 text-warning ${size === "xs" ? "text-xs" : "text-sm"}`}
      title={issue}
    >
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">Bank connection needs attention — reconnect at SimpleFin</span>
    </div>
  );
}
