import { describe, expect, it } from "vitest";

import {
  checkDatesInMonth,
  checksPerYear,
  frequencyLabel,
  upcomingCheckDates,
  type ScheduleSpec,
} from "@/lib/income-schedule";

const biweekly = (anchorDate: string): ScheduleSpec => ({
  frequency: "biweekly",
  anchorDate,
  secondDayOfMonth: null,
});

describe("checkDatesInMonth: biweekly", () => {
  it("gives a 3-check month when the anchor lands on the 1st cycle", () => {
    const dates = checkDatesInMonth(biweekly("2026-07-03"), "2026-07-01");
    expect(dates).toEqual(["2026-07-03", "2026-07-17", "2026-07-31"]);
  });

  it("gives the following month only 2 checks", () => {
    const dates = checkDatesInMonth(biweekly("2026-07-03"), "2026-08-01");
    expect(dates).toEqual(["2026-08-14", "2026-08-28"]);
  });

  it("aligns identically regardless of how far in the past the anchor is", () => {
    // 2026-01-02 is an exact 14-day multiple from 2026-07-03.
    expect(checkDatesInMonth(biweekly("2026-01-02"), "2026-07-01")).toEqual(
      checkDatesInMonth(biweekly("2026-07-03"), "2026-07-01"),
    );
  });

  it("aligns identically regardless of how far in the future the anchor is", () => {
    // 2026-12-18 is an exact 14-day multiple from 2026-07-03.
    expect(checkDatesInMonth(biweekly("2026-12-18"), "2026-07-01")).toEqual(
      checkDatesInMonth(biweekly("2026-07-03"), "2026-07-01"),
    );
  });

  it("includes the anchor date itself when it's on the 1st", () => {
    expect(checkDatesInMonth(biweekly("2026-07-01"), "2026-07-01")[0]).toBe("2026-07-01");
  });

  it("steps 14 days across the spring DST transition without shifting", () => {
    // US DST transitions in 2026: 2026-03-08 (spring), 2026-11-01 (fall).
    const dates = checkDatesInMonth(biweekly("2026-02-27"), "2026-03-01");
    expect(dates).toEqual(["2026-03-13", "2026-03-27"]);
  });
});

describe("checkDatesInMonth: weekly", () => {
  it("gives 5 Fridays in July 2026", () => {
    const dates = checkDatesInMonth(
      { frequency: "weekly", anchorDate: "2026-07-03", secondDayOfMonth: null },
      "2026-07-01",
    );
    expect(dates).toEqual([
      "2026-07-03",
      "2026-07-10",
      "2026-07-17",
      "2026-07-24",
      "2026-07-31",
    ]);
  });
});

describe("checkDatesInMonth: semimonthly", () => {
  const spec: ScheduleSpec = {
    frequency: "semimonthly",
    anchorDate: "2026-07-15",
    secondDayOfMonth: 31,
  };

  it("gives the 15th plus a clamped 31st", () => {
    expect(checkDatesInMonth(spec, "2026-09-01")).toEqual(["2026-09-15", "2026-09-30"]);
  });

  it("clamps correctly in February", () => {
    expect(checkDatesInMonth(spec, "2027-02-01")).toEqual(["2027-02-15", "2027-02-28"]);
  });

  it("dedupes when both clamped days land on the same date", () => {
    const equalClampSpec: ScheduleSpec = {
      frequency: "semimonthly",
      anchorDate: "2027-02-28",
      secondDayOfMonth: 30,
    };
    expect(checkDatesInMonth(equalClampSpec, "2027-02-01")).toEqual(["2027-02-28"]);
  });
});

describe("checkDatesInMonth: monthly", () => {
  it("clamps day-31 to Apr 30", () => {
    const dates = checkDatesInMonth(
      { frequency: "monthly", anchorDate: "2026-01-31", secondDayOfMonth: null },
      "2026-04-01",
    );
    expect(dates).toEqual(["2026-04-30"]);
  });
});

describe("checkDatesInMonth: irregular / missing anchor", () => {
  it("returns no dates for irregular frequency", () => {
    const dates = checkDatesInMonth(
      { frequency: "irregular", anchorDate: null, secondDayOfMonth: null },
      "2026-07-01",
    );
    expect(dates).toHaveLength(0);
  });

  it("returns no dates when the anchor is missing", () => {
    const dates = checkDatesInMonth(
      { frequency: "biweekly", anchorDate: null, secondDayOfMonth: null },
      "2026-07-01",
    );
    expect(dates).toHaveLength(0);
  });
});

describe("upcomingCheckDates", () => {
  it("crosses a month boundary", () => {
    const dates = upcomingCheckDates(biweekly("2026-07-03"), "2026-07-22", 3);
    expect(dates).toEqual(["2026-07-31", "2026-08-14", "2026-08-28"]);
  });

  it("crosses a year boundary", () => {
    const dates = upcomingCheckDates(biweekly("2026-12-25"), "2026-12-26", 2);
    expect(dates).toEqual(["2027-01-08", "2027-01-22"]);
  });

  it("excludes the fromDate itself", () => {
    expect(upcomingCheckDates(biweekly("2026-07-03"), "2026-07-03", 1)[0]).toBe("2026-07-17");
  });

  it("returns empty for irregular frequency (bounded loop, no infinite scan)", () => {
    const dates = upcomingCheckDates(
      { frequency: "irregular", anchorDate: null, secondDayOfMonth: null },
      "2026-07-01",
      3,
    );
    expect(dates).toHaveLength(0);
  });
});

describe("checksPerYear / frequencyLabel", () => {
  it("reports 26 checks/yr for biweekly", () => {
    expect(checksPerYear("biweekly")).toBe(26);
  });

  it("reports no checks/yr for irregular", () => {
    expect(checksPerYear("irregular")).toBeNull();
  });

  it("labels biweekly as 'Bi-weekly'", () => {
    expect(frequencyLabel("biweekly")).toBe("Bi-weekly");
  });
});
