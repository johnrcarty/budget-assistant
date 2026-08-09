import { describe, expect, it } from "vitest";
import {
  filledSegments,
  percentOfPlan,
  progressTone,
} from "./segmented-progress";

describe("progressTone", () => {
  it("is ok with no plan and no spend", () => {
    expect(progressTone(0, 0)).toBe("ok");
  });

  it("is over when spending against a zero plan", () => {
    expect(progressTone(1, 0)).toBe("over");
  });

  it("is ok below the warn threshold", () => {
    expect(progressTone(84_99, 100_00)).toBe("ok");
  });

  it("warns at exactly 85%", () => {
    expect(progressTone(85_00, 100_00)).toBe("warn");
  });

  it("stays warn at exactly 100%", () => {
    expect(progressTone(100_00, 100_00)).toBe("warn");
  });

  it("is over past 100%", () => {
    expect(progressTone(100_01, 100_00)).toBe("over");
  });
});

describe("filledSegments", () => {
  it("fills nothing on an untouched budget", () => {
    expect(filledSegments(0, 100_00, 28)).toBe(0);
  });

  it("lights at least one segment for a tiny spend", () => {
    expect(filledSegments(1, 100_00, 28)).toBe(1);
  });

  it("fills exactly at 100%", () => {
    expect(filledSegments(100_00, 100_00, 28)).toBe(28);
  });

  it("caps at the segment count when over plan", () => {
    expect(filledSegments(250_00, 100_00, 28)).toBe(28);
  });

  it("fills everything when spending against a zero plan", () => {
    expect(filledSegments(50_00, 0, 28)).toBe(28);
  });

  it("fills nothing for zero plan and zero spend", () => {
    expect(filledSegments(0, 0, 28)).toBe(0);
  });

  it("treats refunds (negative spend) as empty", () => {
    expect(filledSegments(-5_00, 100_00, 28)).toBe(0);
  });
});

describe("percentOfPlan", () => {
  it("guards division by a zero plan", () => {
    expect(percentOfPlan(50_00, 0)).toBe(0);
  });

  it("rounds to the nearest percent", () => {
    expect(percentOfPlan(38_4, 100_0)).toBe(38);
  });

  it("reports over 100 when over plan", () => {
    expect(percentOfPlan(150_00, 100_00)).toBe(150);
  });
});
