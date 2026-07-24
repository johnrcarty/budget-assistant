export type DisplayMode = "planned" | "spent" | "remaining";

// Desktop (md+) drops the Planned/Spent/Remaining tabs and shows all three
// as aligned columns. One shared template keeps the group header, the
// column-label row, and every item row lined up; mobile keeps the tabbed
// single-amount layout untouched.
export const MODE_COLUMNS_GRID =
  "md:grid md:grid-cols-[minmax(0,1fr)_repeat(3,7rem)] md:items-center md:gap-x-4";

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
