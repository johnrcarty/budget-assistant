import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  annualEntryBody,
  annualIncomeView,
  annualMoneyInput,
  annualPersonColor,
  layoutAnnualIncome,
} from "../src/lib/annual-income.js";

const fixture = () => ({
  current_year: 2026,
  through_year: 2028,
  people: [
    { id: 1, name: "John", color: "chart-1", active: true },
    { id: 2, name: "Natasha", color: "#457e8e", active: false },
    { id: 3, name: "Unused account owner", active: true },
  ],
  actuals: [
    { person_id: 1, year: 2023, amount_cents: 5000 },
    { person_id: 2, year: 2023, amount_cents: 6000 },
    { person_id: 1, year: 2024, amount_cents: 10000 },
    { person_id: 2, year: 2024, amount_cents: 20000 },
    { person_id: 1, year: 2025, amount_cents: 0 },
    { person_id: 2, year: 2025, amount_cents: 25000 },
    { person_id: 1, year: 2026, amount_cents: 14000 },
  ],
  selected_forecast: {
    id: 41,
    name: "Projection from 2024",
    base_year: 2024,
    horizon_year: 2028,
    baseline_source: "creation_actuals",
    baseline: [
      { person_id: 1, year: 2023, amount_cents: 5000 },
      { person_id: 2, year: 2023, amount_cents: 6000 },
      { person_id: 1, year: 2024, amount_cents: 10000 },
      { person_id: 2, year: 2024, amount_cents: 20000 },
    ],
    points: [2025, 2026, 2027, 2028].flatMap((year, index) => [
      { person_id: 1, year, amount_cents: 11000 + index * 1000 },
      { person_id: 2, year, amount_cents: 22000 + index * 2000 },
    ]),
  },
});

test("the default view ends at the current year and excludes unused people", () => {
  const view = annualIncomeView(fixture());
  assert.deepEqual(view.years, [2023, 2024, 2025, 2026]);
  assert.deepEqual(
    view.people.map((person) => person.id),
    [1, 2],
  );
  assert.equal(
    view.people[1].active,
    false,
    "archived people's history remains visible",
  );
  assert.equal(view.rows.at(-1).reported_people, 1);
  assert.equal(view.rows.at(-1).missing_people, 1);
});

test("future projections do not extend actual paths or synthesize zero income", () => {
  const view = annualIncomeView(fixture(), { future: true });
  assert.equal(view.years.at(-1), 2028);
  assert.equal(view.actualSeries[0].values[2027], undefined);
  assert.equal(view.rows.at(-1).actual_cents, null);
  const layout = layoutAnnualIncome(view, 320);
  assert.equal(layout.bands[0].segments.at(-1).points.at(-1).year, 2026);
  assert.equal(layout.bands[1].segments.at(-1).points.at(-1).year, 2025);
  assert.equal(layout.lines.at(-1).segments.at(-1).points.at(-1).year, 2028);
});

test("a measured zero remains data while an unrecorded year breaks the path", () => {
  const data = fixture();
  data.actuals = data.actuals.filter(
    (row) => row.person_id !== 1 || row.year !== 2024,
  );
  const view = annualIncomeView(data, { personId: 1 });
  assert.equal(view.actualSeries[0].values[2025], 0);
  assert.equal(view.actualSeries[0].values[2024], undefined);
  const segments = layoutAnnualIncome(view).bands[0].segments;
  assert.deepEqual(
    segments.map((segment) => segment.points.map((point) => point.year)),
    [[2023], [2025, 2026]],
  );
});

test("running actuals appear only in that person's recorded years", () => {
  const view = annualIncomeView(fixture(), { running: true, future: true });
  assert.equal(view.actualSeries[0].values[2025], 15000);
  assert.equal(view.actualSeries[0].values[2026], 29000);
  assert.equal(view.actualSeries[1].values[2025], 51000);
  assert.equal(view.actualSeries[1].values[2026], undefined);
  assert.equal(view.actualSeries[0].values[2027], undefined);
});

test("later edits to actuals do not rewrite a vintage's running baseline", () => {
  const data = fixture();
  const before = annualIncomeView(data, { running: true });
  data.actuals[0].amount_cents = 999000;
  const after = annualIncomeView(data, { running: true });
  assert.equal(after.forecastSeries[0].values[2024], 15000);
  assert.equal(after.forecastSeries[0].values[2026], 38000);
  assert.deepEqual(after.forecastSeries, before.forecastSeries);
  assert.notDeepEqual(after.actualSeries, before.actualSeries);
});

test("a missing legacy baseline cannot fabricate a running forecast starting at zero", () => {
  const data = fixture();
  data.selected_forecast.baseline = [];
  assert.deepEqual(
    annualIncomeView(data, { running: true }).forecastSeries,
    [],
  );
  assert.equal(annualIncomeView(data).forecastSeries[0].values[2025], 11000);
});

test("income outside an older forecast is excluded from the comparison", () => {
  const data = fixture();
  data.people.push({ id: 4, name: "New income earner" });
  data.actuals.push({ person_id: 4, year: 2026, amount_cents: 90000 });
  const row = annualIncomeView(data).rows.at(-1);
  assert.equal(row.actual_cents, 104000);
  assert.equal(row.forecast_cents, 36000);
  assert.equal(
    row.difference_cents,
    2000,
    "compare John only, without unknown Natasha or the new person",
  );
  assert.equal(row.comparison_people, 1);
});

test("switching between saved forecast versions uses each version's exact points", () => {
  const data = fixture();
  const first = annualIncomeView(data).rows.at(-1);
  data.selected_forecast = {
    ...data.selected_forecast,
    name: "Earlier projection",
    points: [{ person_id: 1, year: 2026, amount_cents: 9000 }],
  };
  const second = annualIncomeView(data).rows.at(-1);
  assert.equal(first.difference_cents, 2000);
  assert.equal(second.difference_cents, 5000);
  assert.equal(second.projected[1], null);
});

test("actuals-only and a person without records have honest empty views", () => {
  const data = fixture();
  data.selected_forecast = null;
  assert.deepEqual(annualIncomeView(data).forecastSeries, []);
  const empty = annualIncomeView(data, { personId: 3 });
  assert.equal(empty.people.length, 1);
  assert.deepEqual(empty.years, []);
  assert.deepEqual(empty.rows, []);
});

test("the signed axis and separate positive/negative stacks preserve corrections", () => {
  const data = fixture();
  data.actuals = [
    { person_id: 1, year: 2026, amount_cents: -1000 },
    { person_id: 2, year: 2026, amount_cents: 2000 },
  ];
  data.selected_forecast = null;
  const layout = layoutAnnualIncome(annualIncomeView(data), 300);
  assert.equal(layout.low, -1000);
  assert.equal(layout.high, 2000);
  assert.ok(layout.top < layout.zero && layout.zero < layout.bottom);
  assert.equal(layout.bands[0].segments[0].points[0].lower, 0);
  assert.equal(layout.bands[1].segments[0].points[0].lower, 0);
  for (const band of layout.bands) {
    assert.doesNotMatch(band.segments[0].area, /NaN|Infinity/);
  }
});

test("a single explicit zero has a finite chart and centered year tick", () => {
  const data = fixture();
  data.actuals = [{ person_id: 1, year: 2026, amount_cents: 0 }];
  data.selected_forecast = null;
  const layout = layoutAnnualIncome(annualIncomeView(data), 320);
  assert.equal(layout.x(0), 160);
  assert.deepEqual(layout.ticks, [0]);
  assert.equal(layout.bands[0].segments[0].points[0].amount, 0);
  assert.doesNotMatch(layout.bands[0].segments[0].area, /NaN|Infinity/);
});

test("person filtering keeps colors stable, including original chart tokens", () => {
  const data = fixture();
  delete data.people[1].color;
  const all = annualIncomeView(data);
  const one = annualIncomeView(data, { personId: 2 });
  assert.equal(all.actualSeries[1].color, one.actualSeries[0].color);
  assert.equal(annualPersonColor({ color: "#457e8e" }, 7), "#457e8e");
  assert.equal(
    annualPersonColor({ color: "chart-1" }, 7),
    annualPersonColor({}, 0),
  );
  assert.match(annualPersonColor({ color: "chart-8" }), /^#/);
});

test("manual annual inputs retain signed cents, optional taxes and bounded years", () => {
  const entry = annualEntryBody({
    person_id: "1",
    year: "2026",
    source: " W-2 ",
    amount: "-123.45",
    fed_tax_cents: "0",
    note: "Correction",
  });
  assert.equal(entry.amount_cents, -12345);
  assert.equal(entry.fed_tax_cents, 0);
  assert.equal(entry.state_tax_cents, null);
  assert.equal(entry.source, "W-2");
  assert.equal(annualMoneyInput("0.01"), 1);
  assert.throws(() => annualMoneyInput("1.001"));
  assert.throws(() => annualMoneyInput("10000000000.01"));
  assert.throws(() => annualEntryBody({ ...entry, year: 2201, amount: "1" }));
});

test("chart markup exposes exact-value year inspection and a single total forecast for stacked people", async () => {
  const require = createRequire(import.meta.url);
  const { build } = require("esbuild");
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import Chart from './src/components/AnnualIncomeChart.jsx'; export function render(view, forecast) { return renderToStaticMarkup(<Chart view={view} forecast={forecast} running={false}/>); }`,
      resolveDir: new URL("..", import.meta.url).pathname,
      loader: "jsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
    jsx: "automatic",
  });
  const output = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    require,
    output,
    output.exports,
  );
  const data = fixture();
  const view = annualIncomeView(data, { future: true });
  const markup = output.exports.render(view, data.selected_forecast);
  assert.match(markup, /Use left and right arrow keys to inspect years/);
  assert.match(markup, /Inspect year/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /John: Not recorded/);
  assert.match(markup, /Reported forecast total/);
  assert.equal((markup.match(/stroke-dasharray="5 4"/g) || []).length, 1);
  assert.match(
    output.exports.render(
      annualIncomeView(data, { personId: 1 }),
      data.selected_forecast,
    ),
    /stroke-dasharray="5 4"/,
  );
});
