import { daysInMonth } from "@/lib/month";

// dueDay is a day-of-month integer; clamp to the month's length so e.g.
// dueDay 31 in September resolves to Sept 30 instead of an invalid date.
export function clampedDueDate(month: string, dueDay: number): string {
  const day = Math.min(dueDay, daysInMonth(month));
  return `${month.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}

// One dated entry in the month's money timeline - a bill (expense with a
// due day) or an expected paycheck. Undated items never appear here.
export interface UpcomingEntry {
  key: string;
  date: string; // YYYY-MM-DD
  name: string;
  amountCents: number;
  kind: "income" | "expense";
  // expense: any spend recorded against the item; income: any amount received
  settled: boolean;
  href: string | null;
}

export interface UpcomingMoneyInput {
  month: string; // YYYY-MM-01
  today: string; // YYYY-MM-DD
  items: Array<{
    id: string | null;
    templateId: string | null;
    name: string;
    plannedAmountCents: number;
    dueDay: number | null;
    spentCents: number;
  }>;
  income: Array<{
    id: string;
    name: string;
    plannedAmountCents: number;
    expectedDate: string | null;
    receivedCents: number;
  }>;
}

export interface UpcomingMoney {
  // What the "Coming Up" scroller shows: unsettled entries from today on for
  // the current month, everything for future months, nothing for past months.
  upcoming: UpcomingEntry[];
  // Every dated entry in the viewed month, settled included ("View all").
  monthAll: UpcomingEntry[];
}

export function assembleUpcomingMoney(
  input: UpcomingMoneyInput,
): UpcomingMoney {
  const { month, today, items, income } = input;
  const monthPrefix = month.slice(0, 7);

  const entries: UpcomingEntry[] = [];

  for (const item of items) {
    if (item.dueDay === null) continue;
    entries.push({
      key: item.id ? `item:${item.id}` : `projected:${item.templateId}`,
      date: clampedDueDate(month, item.dueDay),
      name: item.name,
      amountCents: item.plannedAmountCents,
      kind: "expense",
      settled: item.spentCents > 0,
      href: item.id
        ? `/budget/item/${item.id}`
        : item.templateId
          ? `/budget/item/debt/${item.templateId}?month=${month}`
          : null,
    });
  }

  for (const check of income) {
    if (!check.expectedDate || !check.expectedDate.startsWith(monthPrefix)) {
      continue;
    }
    entries.push({
      key: `income:${check.id}`,
      date: check.expectedDate,
      name: check.name,
      amountCents: check.plannedAmountCents,
      kind: "income",
      settled: check.receivedCents > 0,
      href: `/budget/income?month=${month}`,
    });
  }

  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "income" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const todayMonth = today.slice(0, 7);
  let upcoming: UpcomingEntry[];
  if (monthPrefix < todayMonth) {
    upcoming = [];
  } else if (monthPrefix > todayMonth) {
    upcoming = entries;
  } else {
    upcoming = entries.filter((e) => e.date >= today && !e.settled);
  }

  return { upcoming, monthAll: entries };
}
