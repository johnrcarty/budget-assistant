export type DisplayMode = "planned" | "spent" | "remaining";

export const DISPLAY_MODES: DisplayMode[] = ["planned", "spent", "remaining"];

export function isDisplayMode(value: string | undefined): value is DisplayMode {
  return value === "planned" || value === "spent" || value === "remaining";
}

// spentCents is always 0 until Phase 3 wires up real transactions - "spent"
// and "remaining" already work end-to-end, they just have nothing to
// subtract yet.
export function amountForMode(
  plannedCents: number,
  spentCents: number,
  mode: DisplayMode,
): number {
  switch (mode) {
    case "planned":
      return plannedCents;
    case "spent":
      return spentCents;
    case "remaining":
      return plannedCents - spentCents;
  }
}
