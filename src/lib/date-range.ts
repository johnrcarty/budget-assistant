export type DateRangePreset = "30d" | "90d" | "month" | "all";

export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  month: "This month",
  all: "All time",
};

export function isDateRangePreset(value: string | undefined): value is DateRangePreset {
  return value === "30d" || value === "90d" || value === "month" || value === "all";
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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
    case "month": {
      const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
      return { startDate: toIsoDate(start) };
    }
    case "all":
      return {};
  }
}
