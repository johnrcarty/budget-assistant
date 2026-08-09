// Pure math for the segmented ("pixel") progress bars. Kept out of the
// component so the thresholds and rounding are unit-testable.

export type ProgressTone = "ok" | "warn" | "over";

// Amber once spending crosses this share of plan; red past 100%.
const WARN_RATIO = 0.85;

export function progressTone(
  spentCents: number,
  plannedCents: number,
): ProgressTone {
  if (plannedCents <= 0) return spentCents > 0 ? "over" : "ok";
  if (spentCents > plannedCents) return "over";
  if (spentCents / plannedCents >= WARN_RATIO) return "warn";
  return "ok";
}

// ceil so any nonzero spend lights at least one segment; clamped so an
// over-plan category fills the bar instead of overflowing it.
export function filledSegments(
  spentCents: number,
  plannedCents: number,
  segmentCount: number,
): number {
  if (plannedCents <= 0) return spentCents > 0 ? segmentCount : 0;
  if (spentCents <= 0) return 0;
  return Math.min(
    segmentCount,
    Math.ceil((spentCents / plannedCents) * segmentCount),
  );
}

export function percentOfPlan(spentCents: number, plannedCents: number): number {
  if (plannedCents <= 0) return 0;
  return Math.round((spentCents / plannedCents) * 100);
}
