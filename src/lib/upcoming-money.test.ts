import { describe, expect, it } from "vitest";
import { assembleUpcomingMoney, clampedDueDate } from "./upcoming-money";

function expenseItem(
  overrides: Partial<Parameters<typeof assembleUpcomingMoney>[0]["items"][number]> = {},
) {
  return {
    id: "item-1",
    templateId: "tpl-1",
    name: "Netflix",
    plannedAmountCents: 26_68,
    dueDay: 10,
    spentCents: 0,
    ...overrides,
  };
}

function incomeCheck(
  overrides: Partial<Parameters<typeof assembleUpcomingMoney>[0]["income"][number]> = {},
) {
  return {
    id: "inc-1",
    name: "Payday",
    plannedAmountCents: 2_145_00,
    expectedDate: "2026-08-16",
    receivedCents: 0,
    ...overrides,
  };
}

describe("clampedDueDate", () => {
  it("builds a date within the month", () => {
    expect(clampedDueDate("2026-08-01", 10)).toBe("2026-08-10");
  });

  it("clamps day 31 in a 30-day month", () => {
    expect(clampedDueDate("2026-09-01", 31)).toBe("2026-09-30");
  });

  it("clamps day 31 in February", () => {
    expect(clampedDueDate("2026-02-01", 31)).toBe("2026-02-28");
  });
});

describe("assembleUpcomingMoney", () => {
  const month = "2026-08-01";

  it("skips undated expenses entirely", () => {
    const { upcoming, monthAll } = assembleUpcomingMoney({
      month,
      today: "2026-08-08",
      items: [expenseItem({ dueDay: null })],
      income: [],
    });
    expect(monthAll).toHaveLength(0);
    expect(upcoming).toHaveLength(0);
  });

  it("filters the scroller to unsettled entries from today on in the current month", () => {
    const { upcoming, monthAll } = assembleUpcomingMoney({
      month,
      today: "2026-08-08",
      items: [
        expenseItem({ id: "past", name: "Rent", dueDay: 1 }),
        expenseItem({ id: "paid", name: "Water", dueDay: 20, spentCents: 40_00 }),
        expenseItem({ id: "due", name: "Netflix", dueDay: 10 }),
      ],
      income: [incomeCheck()],
    });
    expect(monthAll).toHaveLength(4);
    expect(upcoming.map((e) => e.name)).toEqual(["Netflix", "Payday"]);
  });

  it("includes today's entries in the scroller", () => {
    const { upcoming } = assembleUpcomingMoney({
      month,
      today: "2026-08-10",
      items: [expenseItem({ dueDay: 10 })],
      income: [],
    });
    expect(upcoming).toHaveLength(1);
  });

  it("returns nothing upcoming for past months but keeps the full list", () => {
    const { upcoming, monthAll } = assembleUpcomingMoney({
      month: "2026-07-01",
      today: "2026-08-08",
      items: [expenseItem({ dueDay: 10 })],
      income: [incomeCheck({ expectedDate: "2026-07-16" })],
    });
    expect(upcoming).toHaveLength(0);
    expect(monthAll).toHaveLength(2);
  });

  it("shows everything for future months", () => {
    const { upcoming } = assembleUpcomingMoney({
      month: "2026-09-01",
      today: "2026-08-08",
      items: [expenseItem({ dueDay: 1 })],
      income: [incomeCheck({ expectedDate: "2026-09-01" })],
    });
    expect(upcoming).toHaveLength(2);
  });

  it("excludes income expected outside the viewed month", () => {
    const { monthAll } = assembleUpcomingMoney({
      month,
      today: "2026-08-08",
      items: [],
      income: [
        incomeCheck({ expectedDate: "2026-09-01" }),
        incomeCheck({ id: "inc-2", expectedDate: null }),
      ],
    });
    expect(monthAll).toHaveLength(0);
  });

  it("sorts by date with income first on ties", () => {
    const { monthAll } = assembleUpcomingMoney({
      month,
      today: "2026-08-08",
      items: [
        expenseItem({ id: "b", name: "Mortgage", dueDay: 16 }),
        expenseItem({ id: "a", name: "Netflix", dueDay: 10 }),
      ],
      income: [incomeCheck({ expectedDate: "2026-08-16" })],
    });
    expect(monthAll.map((e) => e.name)).toEqual(["Netflix", "Payday", "Mortgage"]);
  });

  it("clamps due days past the month's end", () => {
    const { monthAll } = assembleUpcomingMoney({
      month: "2026-09-01",
      today: "2026-08-08",
      items: [expenseItem({ dueDay: 31 })],
      income: [],
    });
    expect(monthAll[0].date).toBe("2026-09-30");
  });

  it("links projected debt items to the materialize route", () => {
    const { monthAll } = assembleUpcomingMoney({
      month,
      today: "2026-08-08",
      items: [expenseItem({ id: null, templateId: "tpl-9", name: "Car Loan" })],
      income: [],
    });
    expect(monthAll[0].key).toBe("projected:tpl-9");
    expect(monthAll[0].href).toBe("/budget/item/debt/tpl-9?month=2026-08-01");
  });
});
