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
  // With no plan, spending still fills the bar ("over"), so the meter's max
  // has to follow the spend or screen readers would hear 0-of-0 on a full bar.
  const meterMax = plannedCents > 0 ? plannedCents : Math.max(spentCents, 0);

  return (
    <div
      role="meter"
      aria-label={ariaLabel ?? "Spent of planned"}
      aria-valuemin={0}
      aria-valuemax={meterMax}
      aria-valuenow={Math.max(0, Math.min(spentCents, meterMax))}
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
