export const DATE_RANGE_PRESETS = [
  "30d",
  "90d",
  "month",
  "ytd",
  "1y",
  "lastyear",
  "all",
] as const;

export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  month: "This month",
  ytd: "Year to date",
  "1y": "Last 12 months",
  lastyear: "Last year",
  all: "All time",
};

export function isDateRangePreset(value: string | undefined): value is DateRangePreset {
  return (DATE_RANGE_PRESETS as readonly string[]).includes(value ?? "");
}

// Local-date formatting; toISOString() would shift a day near midnight in
// negative-UTC-offset zones.
function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

// Returns { startDate, endDate } as YYYY-MM-DD, or undefined bounds for "all".
export function resolveDateRange(preset: DateRangePreset): {
  startDate?: string;
  endDate?: string;
} {
  const now = new Date();

  switch (preset) {
    case "30d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      return { startDate: toIsoDate(start) };
    }
    case "90d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 89);
      return { startDate: toIsoDate(start) };
    }
    case "month":
      return { startDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01` };
    case "ytd":
      return { startDate: `${now.getFullYear()}-01-01` };
    case "1y": {
      const start = new Date(now);
      start.setFullYear(start.getFullYear() - 1);
      start.setDate(start.getDate() + 1);
      return { startDate: toIsoDate(start) };
    }
    case "lastyear": {
      const year = now.getFullYear() - 1;
      return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
    }
    case "all":
      return {};
  }
}
