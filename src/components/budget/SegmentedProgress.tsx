import { cn } from "@/lib/utils";
import {
  filledSegments,
  progressTone,
  type ProgressTone,
} from "@/lib/segmented-progress";

const TONE_FILL: Record<ProgressTone, string> = {
  ok: "bg-primary",
  warn: "bg-warning",
  over: "bg-destructive",
};

// Discrete-segment ("pixel") progress bar. Hook-free so it renders in both
// server and client trees.
export function SegmentedProgress({
  spentCents,
  plannedCents,
  segments = 28,
  className,
  "aria-label": ariaLabel,
}: {
  spentCents: number;
  plannedCents: number;
  segments?: number;
  className?: string;
  "aria-label"?: string;
}) {
  const filled = filledSegments(spentCents, plannedCents, segments);
  const tone = progressTone(spentCents, plannedCents);

  return (
    <div
      role="meter"
      aria-label={ariaLabel ?? "Spent of planned"}
      aria-valuemin={0}
      aria-valuemax={plannedCents}
      aria-valuenow={Math.max(0, Math.min(spentCents, plannedCents))}
      className={cn("flex gap-[3px]", className)}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-2 flex-1 rounded-[1px]",
            i < filled ? TONE_FILL[tone] : "bg-foreground/10",
          )}
        />
      ))}
    </div>
  );
}
