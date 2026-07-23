import { describe, expect, it } from "vitest";

import { FORECAST_MODELS, parsePatternRates } from "@/server/lib/income-forecast";

describe("FORECAST_MODELS.pattern", () => {
  it("computes a hand-checked cycle ($100k in 2024, 3.5/3.5/3.5/10)", () => {
    const points = FORECAST_MODELS.pattern.compute({
      actualsByYear: new Map([
        [2023, 9000000],
        [2024, 10000000],
      ]),
      baseYear: 2024,
      horizonYear: 2028,
      params: { ratesBps: [350, 350, 350, 1000] },
    });
    const byYear = Object.fromEntries(points.map((p) => [p.year, p.amountCents]));

    expect(byYear[2025]).toBe(10350000); // 100k * 1.035 = 103,500.00
    expect(byYear[2026]).toBe(10712250); // 107,122.50
    expect(Math.abs(byYear[2027] - 11087179)).toBeLessThanOrEqual(1); // 110,871.53
    expect(Math.abs(byYear[2028] - 12195897)).toBeLessThanOrEqual(2); // jumps 10% = 121,958.97
    expect(points.every((p) => p.year > 2024)).toBe(true); // nothing at/before base year
  });

  it("seeds from the latest actual AT/BEFORE the base year, ignoring later actuals", () => {
    const points = FORECAST_MODELS.pattern.compute({
      actualsByYear: new Map([
        [2020, 5000000],
        [2024, 10000000], // later data must be ignored for baseYear 2020
      ]),
      baseYear: 2020,
      horizonYear: 2022,
      params: { ratesBps: [1000] },
    });
    const byYear = Object.fromEntries(points.map((p) => [p.year, p.amountCents]));
    expect(byYear[2021]).toBe(5500000); // 50k * 1.10
  });
});

describe("FORECAST_MODELS.linear_regression", () => {
  it("projects a perfect line (+$5k/yr from $50k, 2020..2024)", () => {
    const actuals = new Map<number, number>();
    for (let i = 0; i <= 4; i++) actuals.set(2020 + i, 5000000 + i * 500000);
    const points = FORECAST_MODELS.linear_regression.compute({
      actualsByYear: actuals,
      baseYear: 2024,
      horizonYear: 2026,
      params: {},
    });
    const byYear = Object.fromEntries(points.map((p) => [p.year, p.amountCents]));
    expect(Math.abs(byYear[2025] - 7500000)).toBeLessThanOrEqual(2);
    expect(Math.abs(byYear[2026] - 8000000)).toBeLessThanOrEqual(2);
  });

  it("flattens to a single point when there's only one data point", () => {
    const single = FORECAST_MODELS.linear_regression.compute({
      actualsByYear: new Map([[2024, 8000000]]),
      baseYear: 2024,
      horizonYear: 2026,
      params: {},
    });
    expect(single.every((p) => p.amountCents === 8000000)).toBe(true);
  });

  it("clamps at zero for a declining trend", () => {
    const declining = new Map<number, number>([
      [2020, 4000000],
      [2021, 2000000],
      [2022, 0],
    ]);
    const clamped = FORECAST_MODELS.linear_regression.compute({
      actualsByYear: declining,
      baseYear: 2022,
      horizonYear: 2025,
      params: {},
    });
    expect(clamped.every((p) => p.amountCents >= 0)).toBe(true);
  });
});

describe("parsePatternRates", () => {
  it("parses a comma-separated percentage list into basis points", () => {
    expect(parsePatternRates("3.5, 3.5, 3.5, 10")).toEqual([350, 350, 350, 1000]);
  });

  it("returns null for garbage input", () => {
    expect(parsePatternRates("abc")).toBeNull();
  });
});
