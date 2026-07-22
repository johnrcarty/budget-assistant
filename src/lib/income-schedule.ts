// Pure pay-schedule date math - no server imports, shared by queries, UI,
// and verification scripts. All dates are "YYYY-MM-DD" strings and months
// are "YYYY-MM-01", matching src/lib/month.ts; arithmetic goes through
// Date.UTC so local timezones and DST never shift a date.

import { addDaysToIsoDate, daysInMonth, shiftMonthString } from "@/lib/month";

export type PayFrequency =
  | "weekly"
  | "biweekly"
  | "semimonthly"
  | "monthly"
  | "irregular";

export const PAY_FREQUENCIES: PayFrequency[] = [
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
  "irregular",
];

const FREQUENCY_LABELS: Record<PayFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  semimonthly: "Semi-monthly",
  monthly: "Monthly",
  irregular: "Irregular",
};

const CHECKS_PER_YEAR: Partial<Record<PayFrequency, number>> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

export function isPayFrequency(value: string): value is PayFrequency {
  return (PAY_FREQUENCIES as string[]).includes(value);
}

export function frequencyLabel(frequency: PayFrequency): string {
  return FREQUENCY_LABELS[frequency];
}

export function checksPerYear(frequency: PayFrequency): number | null {
  return CHECKS_PER_YEAR[frequency] ?? null;
}

export interface ScheduleSpec {
  frequency: PayFrequency;
  anchorDate: string | null; // YYYY-MM-DD; null only for irregular
  secondDayOfMonth: number | null; // semimonthly only
}

function toUtcMs(dateString: string): number {
  const [year, month, day] = dateString.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

const DAY_MS = 86_400_000;

export function diffIsoDays(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

// Floored modulo: anchors in the future still align the series correctly.
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function dayOfMonth(dateString: string): number {
  return Number(dateString.split("-")[2]);
}

function dateInMonth(month: string, day: number): string {
  const clamped = Math.min(day, daysInMonth(month));
  return `${month.slice(0, 8)}${String(clamped).padStart(2, "0")}`;
}

// All expected check dates inside the given month, ascending. Empty for
// irregular schedules or ones missing an anchor.
export function checkDatesInMonth(spec: ScheduleSpec, month: string): string[] {
  if (spec.frequency === "irregular" || !spec.anchorDate) return [];

  if (spec.frequency === "weekly" || spec.frequency === "biweekly") {
    const interval = spec.frequency === "weekly" ? 7 : 14;
    const monthStart = dateInMonth(month, 1);
    const offset = mod(diffIsoDays(spec.anchorDate, monthStart), interval);
    let current =
      offset === 0 ? monthStart : addDaysToIsoDate(monthStart, interval - offset);
    const dates: string[] = [];
    while (current.startsWith(month.slice(0, 7))) {
      dates.push(current);
      current = addDaysToIsoDate(current, interval);
    }
    return dates;
  }

  if (spec.frequency === "semimonthly") {
    const days = [dayOfMonth(spec.anchorDate)];
    if (spec.secondDayOfMonth) days.push(spec.secondDayOfMonth);
    const dates = days.map((day) => dateInMonth(month, day)).sort();
    return [...new Set(dates)];
  }

  // monthly
  return [dateInMonth(month, dayOfMonth(spec.anchorDate))];
}

// The next `count` check dates strictly after fromDate, crossing month
// boundaries. Bounded at 24 months so a broken spec can't loop forever.
export function upcomingCheckDates(
  spec: ScheduleSpec,
  fromDate: string,
  count: number,
): string[] {
  const dates: string[] = [];
  let month = `${fromDate.slice(0, 7)}-01`;
  for (let i = 0; i < 24 && dates.length < count; i++) {
    for (const date of checkDatesInMonth(spec, month)) {
      if (date > fromDate && dates.length < count) dates.push(date);
    }
    month = shiftMonthString(month, 1);
  }
  return dates;
}
