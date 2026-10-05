import { colors } from "./format.js";

export const withholdingFields = [
  ["fed_tax_cents", "Federal tax"],
  ["state_tax_cents", "State tax"],
  ["local_tax_cents", "Local tax"],
  ["medicare_cents", "Medicare"],
  ["social_security_cents", "Social Security"],
];
export const knownAmount = (value) =>
  typeof value === "number" && Number.isFinite(value);
export function annualPersonColor(person, index = 0) {
  if (/^#[0-9a-f]{6}$/i.test(person.color || "")) return person.color;
  const legacy = /^chart-([1-8])$/.exec(person.color || "");
  return colors[(legacy ? Number(legacy[1]) - 1 : index) % colors.length];
}
export function sumRecorded(values) {
  const known = values.filter(knownAmount);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}
export function annualMoneyInput(value, { nullable = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text && nullable) return null;
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(text))
    throw new Error("Enter a dollar amount with at most two decimal places.");
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace(/^[+-]/, "").split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount > 1e12)
    throw new Error("The dollar amount is too large.");
  return negative ? -amount : amount;
}
export function annualEntryBody(values) {
  const person_id = Number(values.person_id),
    year = Number(values.year);
  if (!Number.isSafeInteger(person_id) || person_id < 1)
    throw new Error("Choose a person.");
  if (!Number.isInteger(year) || year < 1900 || year > 2200)
    throw new Error("Choose a year between 1900 and 2200.");
  const source = String(values.source || "").trim();
  if (!source) throw new Error("Name the source of income.");
  if (source.length > 40)
    throw new Error("Keep the income source name within 40 characters.");
  return {
    person_id,
    year,
    source,
    amount_cents: annualMoneyInput(values.amount),
    ...Object.fromEntries(
      withholdingFields.map(([key]) => [
        key,
        annualMoneyInput(values[key], { nullable: true }),
      ]),
    ),
    note: String(values.note || "").trim(),
  };
}
export function annualIncomeView(
  data,
  {
    personId = "all",
    running = false,
    currentYear = data.current_year,
    future = false,
  } = {},
) {
  const forecast = data.selected_forecast;
  const referenced = new Set(
    [
      ...(data.actuals || []),
      ...(forecast?.points || []),
      ...(forecast?.baseline || []),
    ].map((row) => row.person_id),
  );
  const people = (data.people || []).filter((person) =>
    personId === "all"
      ? referenced.has(person.id)
      : person.id === Number(personId),
  );
  const actuals = (data.actuals || []).filter((row) =>
    people.some((person) => person.id === row.person_id),
  );
  const points = (forecast?.points || []).filter((row) =>
    people.some((person) => person.id === row.person_id),
  );
  const baseline = (forecast?.baseline || []).filter((row) =>
    people.some((person) => person.id === row.person_id),
  );
  const endYear = future ? data.through_year : currentYear;
  const availableYears = [...actuals, ...points, ...baseline]
    .map((row) => row.year)
    .filter((year) => year <= endYear);
  if (!availableYears.length)
    return {
      people,
      years: [],
      actualSeries: [],
      forecastSeries: [],
      rows: [],
    };
  const startYear = Math.min(...availableYears);
  const years = Array.from(
    { length: endYear - startYear + 1 },
    (_, index) => startYear + index,
  );
  const actualMaps = new Map(
    people.map((person) => [
      person.id,
      Object.fromEntries(
        actuals
          .filter((row) => row.person_id === person.id)
          .map((row) => [row.year, row.amount_cents]),
      ),
    ]),
  );
  const colorFor = (person) =>
    annualPersonColor(
      person,
      (data.people || []).findIndex((row) => row.id === person.id),
    );
  const actualSeries = people.map((person, index) => {
    const original = actualMaps.get(person.id);
    let cumulative = 0,
      measured = false;
    const values = {};
    for (const year of years) {
      if (knownAmount(original[year])) {
        cumulative += original[year];
        measured = true;
      }
      if (running) {
        if (measured && knownAmount(original[year])) values[year] = cumulative;
      } else if (knownAmount(original[year])) values[year] = original[year];
    }
    return {
      key: `actual:${person.id}`,
      person_id: person.id,
      label: person.name,
      color: colorFor(person),
      values,
    };
  });
  const forecastSeries = forecast
    ? people
        .map((person, index) => {
          const values = {};
          const ownBaseline = baseline.filter(
            (row) =>
              row.person_id === person.id && row.year <= forecast.base_year,
          );
          let cumulative = sumRecorded(
            ownBaseline.map((row) => row.amount_cents),
          );
          const baseAmount = sumRecorded(
            ownBaseline
              .filter((row) => row.year === forecast.base_year)
              .map((row) => row.amount_cents),
          );
          if (
            forecast.base_year <= endYear &&
            knownAmount(running ? cumulative : baseAmount)
          )
            values[forecast.base_year] = running ? cumulative : baseAmount;
          for (const point of points
            .filter((row) => row.person_id === person.id)
            .sort((a, b) => a.year - b.year)) {
            if (point.year > endYear) continue;
            if (knownAmount(cumulative)) cumulative += point.amount_cents;
            if (!running || knownAmount(cumulative))
              values[point.year] = running ? cumulative : point.amount_cents;
          }
          return {
            key: `forecast:${person.id}`,
            person_id: person.id,
            label: `${person.name} forecast`,
            color: colorFor(person),
            values,
          };
        })
        .filter((series) => Object.keys(series.values).length)
    : [];
  if (people.length > 1 && forecastSeries.length)
    forecastSeries.push({
      key: "forecast:total",
      label: "Reported forecast total",
      color: "#334b3e",
      total: true,
      values: Object.fromEntries(
        years
          .map((year) => [
            year,
            sumRecorded(forecastSeries.map((series) => series.values[year])),
          ])
          .filter(([, amount]) => knownAmount(amount)),
      ),
    });
  const rows = years.map((year) => {
    const actual = people.map(
      (person) => actualMaps.get(person.id)[year] ?? null,
    );
    const projected = people.map((person) =>
      sumRecorded(
        points
          .filter(
            (point) => point.person_id === person.id && point.year === year,
          )
          .map((point) => point.amount_cents),
      ),
    );
    const amount = sumRecorded(actual),
      forecastAmount = sumRecorded(projected);
    const comparable = actual.map((value, index) =>
      knownAmount(value) && knownAmount(projected[index])
        ? value - projected[index]
        : null,
    );
    return {
      year,
      actual,
      projected,
      actual_cents: amount,
      forecast_cents: forecastAmount,
      reported_people: actual.filter(knownAmount).length,
      missing_people: actual.filter((value) => !knownAmount(value)).length,
      forecast_reported_people: projected.filter(knownAmount).length,
      forecast_missing_people: projected.filter((value) => !knownAmount(value))
        .length,
      comparison_people: comparable.filter(knownAmount).length,
      difference_cents: sumRecorded(comparable),
    };
  });
  return { people, years, actualSeries, forecastSeries, rows };
}

export function contiguousSegments(years, valueFor) {
  const segments = [];
  let current = [];
  years.forEach((year, index) => {
    const value = valueFor(year, index);
    if (value == null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push({ year, index, ...value });
  });
  if (current.length) segments.push(current);
  return segments;
}

export function layoutAnnualIncome(view, width = 680, height = 245) {
  const years = view.years,
    pads = { left: 8, right: 8, top: 18, bottom: 28 };
  const positive = years.map(() => 0),
    negative = years.map(() => 0);
  const rawBands = view.actualSeries.map((series) => {
    const rows = years.map((year, index) => {
      const value = series.values[year];
      if (!knownAmount(value)) return null;
      const lower = value >= 0 ? positive[index] : negative[index];
      const upper = lower + value;
      if (value >= 0) positive[index] = upper;
      else negative[index] = upper;
      return { lower, upper, amount: value };
    });
    return { ...series, rows };
  });
  const all = [
    ...positive,
    ...negative,
    ...view.forecastSeries.flatMap((series) => Object.values(series.values)),
  ];
  const low = Math.min(0, ...all),
    observedHigh = Math.max(0, ...all);
  const high = low === observedHigh ? observedHigh + 100 : observedHigh,
    range = high - low;
  const x = (index) =>
    years.length === 1
      ? width / 2
      : pads.left +
        (index * (width - pads.left - pads.right)) / (years.length - 1);
  const y = (value) =>
    pads.top + ((high - value) / range) * (height - pads.top - pads.bottom);
  const bands = rawBands.map((band) => ({
    ...band,
    segments: contiguousSegments(years, (_year, index) => band.rows[index]).map(
      (segment) => {
        const top = segment
          .map(
            (row, index) =>
              `${index ? "L" : "M"} ${x(row.index)} ${y(row.upper)}`,
          )
          .join(" ");
        const area = `${top} ${[...segment]
          .reverse()
          .map((row) => `L ${x(row.index)} ${y(row.lower)}`)
          .join(" ")} Z`;
        return {
          top,
          area,
          points: segment.map((row) => ({
            ...row,
            x: x(row.index),
            y: y(row.upper),
          })),
        };
      },
    ),
  }));
  const lines = view.forecastSeries.map((series) => ({
    ...series,
    segments: contiguousSegments(years, (year) =>
      knownAmount(series.values[year]) ? { amount: series.values[year] } : null,
    ).map((segment) => ({
      path: segment
        .map(
          (row, index) =>
            `${index ? "L" : "M"} ${x(row.index)} ${y(row.amount)}`,
        )
        .join(" "),
      points: segment.map((row) => ({
        ...row,
        x: x(row.index),
        y: y(row.amount),
      })),
    })),
  }));
  const ticks = [
    ...new Set(
      Array.from({ length: Math.min(5, years.length) }, (_, index) =>
        Math.round(
          (index * (years.length - 1)) / (Math.min(5, years.length) - 1 || 1),
        ),
      ),
    ),
  ];
  return {
    width,
    height,
    x,
    y,
    low,
    high,
    bands,
    lines,
    ticks,
    zero: y(0),
    top: pads.top,
    bottom: height - pads.bottom,
  };
}
