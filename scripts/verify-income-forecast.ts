// Deterministic checks for the income forecast models. No DB, no DAL.
// Run: npx tsx scripts/verify-income-forecast.ts

import { FORECAST_MODELS, parsePatternRates } from "@/server/lib/income-forecast";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` :: ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

// Pattern: $100,000 in 2024, cycle 3.5/3.5/3.5/10 -> hand-checked.
{
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
  check("pattern 2025 = 100k * 1.035 = 103,500.00", byYear[2025] === 10350000, byYear);
  check("pattern 2026 = 107,122.50", byYear[2026] === 10712250, byYear);
  check("pattern 2027 = 110,871.53", byYear[2027] === 11087179 || Math.abs(byYear[2027] - 11087179) <= 1, byYear[2027]);
  check("pattern 2028 jumps 10% = 121,958.97", Math.abs(byYear[2028] - 12195897) <= 2, byYear[2028]);
  check("pattern emits nothing at/before base year", points.every((p) => p.year > 2024));
}

// Pattern seeds from the latest actual AT/BEFORE the base year, even when
// later actuals exist (that's what keeps old-vintage projections honest).
{
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
  check("pattern respects base year cut-off (2021 = 50k * 1.10)", byYear[2021] === 5500000, byYear);
}

// Linear regression: perfect line 2020..2024 (+$5k/yr from $50k) projects on.
{
  const actuals = new Map<number, number>();
  for (let i = 0; i <= 4; i++) actuals.set(2020 + i, 5000000 + i * 500000);
  const points = FORECAST_MODELS.linear_regression.compute({
    actualsByYear: actuals,
    baseYear: 2024,
    horizonYear: 2026,
    params: {},
  });
  const byYear = Object.fromEntries(points.map((p) => [p.year, p.amountCents]));
  check("regression 2025 = 75,000.00", Math.abs(byYear[2025] - 7500000) <= 2, byYear);
  check("regression 2026 = 80,000.00", Math.abs(byYear[2026] - 8000000) <= 2, byYear);
}

// Regression clamps at zero and tolerates a single data point.
{
  const single = FORECAST_MODELS.linear_regression.compute({
    actualsByYear: new Map([[2024, 8000000]]),
    baseYear: 2024,
    horizonYear: 2026,
    params: {},
  });
  check("regression single point -> flat line", single.every((p) => p.amountCents === 8000000), single);

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
  check("regression never goes negative", clamped.every((p) => p.amountCents >= 0), clamped);
}

// Rate parsing.
{
  check("parse '3.5, 3.5, 3.5, 10'", JSON.stringify(parsePatternRates("3.5, 3.5, 3.5, 10")) === "[350,350,350,1000]");
  check("parse garbage -> null", parsePatternRates("abc") === null);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
