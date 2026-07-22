// Pure forecast models for annual income projection - no db, no React.
// Models are looked up by key so new ones can be added without touching the
// storage or UI plumbing: implement compute(), register it, done.
//
// A forecast's points are materialized when it's created and never
// recomputed - old projections are historical artifacts to compare against.

export interface ForecastInput {
  // Actual yearly totals for ONE person, only years at/before the base year.
  actualsByYear: Map<number, number>;
  baseYear: number;
  horizonYear: number;
  params: Record<string, unknown>;
}

export interface ForecastPoint {
  year: number;
  amountCents: number;
}

export interface ForecastModel {
  key: string;
  label: string;
  description: string;
  compute(input: ForecastInput): ForecastPoint[];
}

// Latest actual at/before the base year - the seed value for growth models.
function seedValue(input: ForecastInput): { year: number; amountCents: number } | null {
  let best: { year: number; amountCents: number } | null = null;
  for (const [year, amountCents] of input.actualsByYear) {
    if (year > input.baseYear) continue;
    if (!best || year > best.year) best = { year, amountCents };
  }
  return best;
}

export const DEFAULT_PATTERN_RATES_BPS = [350, 350, 350, 1000];

// Repeating growth cycle, e.g. three years of 3.5% then one year of 10%
// (raise-raise-raise-promotion). params.ratesBps cycles indefinitely.
const patternModel: ForecastModel = {
  key: "pattern",
  label: "Growth pattern",
  description: "A repeating cycle of yearly growth rates",
  compute(input) {
    const rates =
      Array.isArray(input.params.ratesBps) && input.params.ratesBps.length > 0
        ? (input.params.ratesBps as number[])
        : DEFAULT_PATTERN_RATES_BPS;
    const seed = seedValue(input);
    if (!seed) return [];

    const points: ForecastPoint[] = [];
    let value = seed.amountCents;
    let step = 0;
    for (let year = seed.year + 1; year <= input.horizonYear; year++) {
      value = value * (1 + rates[step % rates.length] / 10000);
      step += 1;
      if (year > input.baseYear) {
        points.push({ year, amountCents: Math.round(value) });
      }
    }
    return points;
  },
};

// Ordinary least squares over (year, amount) for actual years at/before the
// base year. Falls back to a flat line when there's only one data point.
const linearRegressionModel: ForecastModel = {
  key: "linear_regression",
  label: "Linear regression",
  description: "Straight-line fit through your actual years",
  compute(input) {
    const observations = [...input.actualsByYear.entries()]
      .filter(([year]) => year <= input.baseYear)
      .sort(([a], [b]) => a - b);
    if (observations.length === 0) return [];

    let slope = 0;
    let intercept = observations[0][1];
    if (observations.length >= 2) {
      const n = observations.length;
      const meanX = observations.reduce((s, [x]) => s + x, 0) / n;
      const meanY = observations.reduce((s, [, y]) => s + y, 0) / n;
      let num = 0;
      let den = 0;
      for (const [x, y] of observations) {
        num += (x - meanX) * (y - meanY);
        den += (x - meanX) * (x - meanX);
      }
      slope = den === 0 ? 0 : num / den;
      intercept = meanY - slope * meanX;
    }

    const points: ForecastPoint[] = [];
    for (let year = input.baseYear + 1; year <= input.horizonYear; year++) {
      points.push({
        year,
        amountCents: Math.max(0, Math.round(intercept + slope * year)),
      });
    }
    return points;
  },
};

export const FORECAST_MODELS: Record<string, ForecastModel> = {
  [patternModel.key]: patternModel,
  [linearRegressionModel.key]: linearRegressionModel,
};

export function isForecastModel(value: string | undefined): boolean {
  return value !== undefined && value in FORECAST_MODELS;
}

// "3.5, 3.5, 3.5, 10" -> [350, 350, 350, 1000]; null when unparseable.
export function parsePatternRates(input: string): number[] | null {
  const rates = input
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((part) => Math.round(Number(part) * 100));
  if (rates.length === 0 || rates.some((r) => !Number.isFinite(r))) return null;
  return rates;
}
