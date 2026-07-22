// Deterministic checks for pay-schedule date math. No DB, no DAL.
// Run: npx tsx scripts/verify-income-schedule.ts

import {
  checkDatesInMonth,
  checksPerYear,
  frequencyLabel,
  upcomingCheckDates,
  type ScheduleSpec,
} from "@/lib/income-schedule";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` :: ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

const biweekly = (anchorDate: string): ScheduleSpec => ({
  frequency: "biweekly",
  anchorDate,
  secondDayOfMonth: null,
});

// Bi-weekly: anchor 2026-07-03 makes July 2026 a 3-check month.
{
  const dates = checkDatesInMonth(biweekly("2026-07-03"), "2026-07-01");
  check("bi-weekly 3-check month", dates.join(",") === "2026-07-03,2026-07-17,2026-07-31", dates);
}
{
  const dates = checkDatesInMonth(biweekly("2026-07-03"), "2026-08-01");
  check("following month has 2 checks", dates.join(",") === "2026-08-14,2026-08-28", dates);
}
// 2026-01-02 and 2026-12-18 are both exact 14-day multiples from 2026-07-03.
check(
  "anchor far in the past still aligns",
  checkDatesInMonth(biweekly("2026-01-02"), "2026-07-01").join(",") ===
    checkDatesInMonth(biweekly("2026-07-03"), "2026-07-01").join(","),
);
check(
  "anchor in the future still aligns",
  checkDatesInMonth(biweekly("2026-12-18"), "2026-07-01").join(",") ===
    checkDatesInMonth(biweekly("2026-07-03"), "2026-07-01").join(","),
);
check(
  "anchor on the 1st includes the 1st",
  checkDatesInMonth(biweekly("2026-07-01"), "2026-07-01")[0] === "2026-07-01",
);
{
  // DST transitions (US: 2026-03-08, 2026-11-01) must not shift the series.
  const dates = checkDatesInMonth(biweekly("2026-02-27"), "2026-03-01");
  check("14-day steps across spring DST", dates.join(",") === "2026-03-13,2026-03-27", dates);
}

// Weekly
{
  const dates = checkDatesInMonth(
    { frequency: "weekly", anchorDate: "2026-07-03", secondDayOfMonth: null },
    "2026-07-01",
  );
  check(
    "weekly gives 5 Fridays in July 2026",
    dates.join(",") === "2026-07-03,2026-07-10,2026-07-17,2026-07-24,2026-07-31",
    dates,
  );
}

// Semi-monthly
{
  const spec: ScheduleSpec = {
    frequency: "semimonthly",
    anchorDate: "2026-07-15",
    secondDayOfMonth: 31,
  };
  check(
    "semimonthly 15th + clamped 31st",
    checkDatesInMonth(spec, "2026-09-01").join(",") === "2026-09-15,2026-09-30",
  );
  check(
    "semimonthly Feb clamp",
    checkDatesInMonth(spec, "2027-02-01").join(",") === "2027-02-15,2027-02-28",
  );
}
{
  const spec: ScheduleSpec = {
    frequency: "semimonthly",
    anchorDate: "2027-02-28",
    secondDayOfMonth: 30,
  };
  const dates = checkDatesInMonth(spec, "2027-02-01");
  check("semimonthly equal clamped days dedupe", dates.join(",") === "2027-02-28", dates);
}

// Monthly
check(
  "monthly day-31 clamps to Apr 30",
  checkDatesInMonth(
    { frequency: "monthly", anchorDate: "2026-01-31", secondDayOfMonth: null },
    "2026-04-01",
  ).join(",") === "2026-04-30",
);

// Irregular / missing anchor
check(
  "irregular has no dates",
  checkDatesInMonth(
    { frequency: "irregular", anchorDate: null, secondDayOfMonth: null },
    "2026-07-01",
  ).length === 0,
);
check(
  "missing anchor has no dates",
  checkDatesInMonth(
    { frequency: "biweekly", anchorDate: null, secondDayOfMonth: null },
    "2026-07-01",
  ).length === 0,
);

// Upcoming dates across boundaries
{
  const dates = upcomingCheckDates(biweekly("2026-07-03"), "2026-07-22", 3);
  check(
    "upcoming crosses month boundary",
    dates.join(",") === "2026-07-31,2026-08-14,2026-08-28",
    dates,
  );
}
{
  const dates = upcomingCheckDates(biweekly("2026-12-25"), "2026-12-26", 2);
  check("upcoming crosses year boundary", dates.join(",") === "2027-01-08,2027-01-22", dates);
}
check(
  "upcoming excludes fromDate itself",
  upcomingCheckDates(biweekly("2026-07-03"), "2026-07-03", 1)[0] === "2026-07-17",
);
check(
  "irregular upcoming is empty (bounded loop)",
  upcomingCheckDates(
    { frequency: "irregular", anchorDate: null, secondDayOfMonth: null },
    "2026-07-01",
    3,
  ).length === 0,
);

// Labels / counts
check("biweekly = 26 checks/yr", checksPerYear("biweekly") === 26);
check("irregular has no checks/yr", checksPerYear("irregular") === null);
check("frequency label", frequencyLabel("biweekly") === "Bi-weekly");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
