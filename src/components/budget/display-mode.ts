export type DisplayMode = "planned" | "spent" | "remaining";

export const DISPLAY_MODES: DisplayMode[] = ["planned", "spent", "remaining"];

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
