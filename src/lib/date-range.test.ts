import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DATE_RANGE_PRESETS,
  isDateRangePreset,
  resolveDateRange,
} from "@/lib/date-range";

// All anchors are local time (TZ is pinned to America/Chicago in
// vitest.config.ts, a negative UTC offset, so any accidental UTC-based
// formatting would shift a day and fail).
function anchor(localIso: string) {
  vi.setSystemTime(new Date(localIso));
}

describe("resolveDateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("anchored at 2026-07-15 noon", () => {
    beforeEach(() => anchor("2026-07-15T12:00:00"));

    it("30d starts 29 days back (30-day window inclusive of today)", () => {
      expect(resolveDateRange("30d")).toEqual({ startDate: "2026-06-16" });
    });

    it("90d starts 89 days back", () => {
      expect(resolveDateRange("90d")).toEqual({ startDate: "2026-04-17" });
    });

    it("month starts on the 1st", () => {
      expect(resolveDateRange("month")).toEqual({ startDate: "2026-07-01" });
    });

    it("ytd starts Jan 1", () => {
      expect(resolveDateRange("ytd")).toEqual({ startDate: "2026-01-01" });
    });

    it("1y starts one year back plus a day", () => {
      expect(resolveDateRange("1y")).toEqual({ startDate: "2025-07-16" });
    });

    it("lastyear is the full prior calendar year, both bounds", () => {
      expect(resolveDateRange("lastyear")).toEqual({
        startDate: "2025-01-01",
        endDate: "2025-12-31",
      });
    });

    it("all has no bounds", () => {
      expect(resolveDateRange("all")).toEqual({});
    });
  });

  it("resolves just after local midnight without a UTC day-shift", () => {
    anchor("2026-07-15T00:30:00");
    expect(resolveDateRange("30d")).toEqual({ startDate: "2026-06-16" });
    expect(resolveDateRange("month")).toEqual({ startDate: "2026-07-01" });
  });

  it("handles a Jan 1 anchor (degenerate month/ytd, 30d crosses years)", () => {
    anchor("2026-01-01T12:00:00");
    expect(resolveDateRange("month")).toEqual({ startDate: "2026-01-01" });
    expect(resolveDateRange("ytd")).toEqual({ startDate: "2026-01-01" });
    expect(resolveDateRange("30d")).toEqual({ startDate: "2025-12-03" });
    expect(resolveDateRange("lastyear")).toEqual({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
  });

  it("handles 30d across a non-leap February", () => {
    anchor("2026-03-01T12:00:00");
    expect(resolveDateRange("30d")).toEqual({ startDate: "2026-01-31" });
  });

  it("handles a Dec 31 anchor", () => {
    anchor("2026-12-31T12:00:00");
    expect(resolveDateRange("ytd")).toEqual({ startDate: "2026-01-01" });
    expect(resolveDateRange("1y")).toEqual({ startDate: "2026-01-01" });
  });

  it("pins JS date-rollover semantics for 1y from a leap day", () => {
    // setFullYear(2027) on Feb 29 rolls to Mar 1, then +1 day => Mar 2.
    anchor("2028-02-29T12:00:00");
    expect(resolveDateRange("1y")).toEqual({ startDate: "2027-03-02" });
  });
});

describe("isDateRangePreset", () => {
  it("accepts every declared preset", () => {
    for (const preset of DATE_RANGE_PRESETS) {
      expect(isDateRangePreset(preset)).toBe(true);
    }
  });

  it("rejects unknown values, undefined, and empty string", () => {
    expect(isDateRangePreset("7d")).toBe(false);
    expect(isDateRangePreset(undefined)).toBe(false);
    expect(isDateRangePreset("")).toBe(false);
  });
});
