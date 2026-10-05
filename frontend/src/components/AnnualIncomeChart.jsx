import { useEffect, useRef, useState } from "react";
import { compactMoney, money } from "../lib/format.js";
import {
  knownAmount,
  layoutAnnualIncome,
  sumRecorded,
} from "../lib/annual-income.js";

export default function AnnualIncomeChart({ view, running, forecast }) {
  const [selectedYear, setSelectedYear] = useState(view.years.at(-1));
  const plotRef = useRef(null);
  const [plotWidth, setPlotWidth] = useState(680);
  useEffect(() => {
    if (!plotRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setPlotWidth(Math.max(240, entry.contentRect.width)),
    );
    observer.observe(plotRef.current);
    return () => observer.disconnect();
  }, [view.years.length > 0]);
  useEffect(() => {
    if (!view.years.includes(selectedYear)) setSelectedYear(view.years.at(-1));
  }, [view.years.join(","), selectedYear]);
  if (!view.years.length)
    return (
      <p className="annual-empty-chart">
        Add an annual income record to start the chart.
      </p>
    );
  const layout = layoutAnnualIncome(view, plotWidth);
  const index = Math.max(0, view.years.indexOf(selectedYear));
  const actualTotal = sumRecorded(
    view.actualSeries.map((series) => series.values[selectedYear]),
  );
  const forecastPeople = new Set(
    (forecast?.points || [])
      .filter((point) =>
        view.people.some((person) => person.id === point.person_id),
      )
      .map((point) => point.person_id),
  );
  function inspect(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * layout.width;
    let best = 0;
    view.years.forEach((_year, cursor) => {
      if (Math.abs(layout.x(cursor) - x) < Math.abs(layout.x(best) - x))
        best = cursor;
    });
    setSelectedYear(view.years[best]);
  }
  return (
    <div className="annual-income-chart">
      <div
        ref={plotRef}
        className="annual-chart-plot"
        tabIndex="0"
        role="group"
        aria-label={`${running ? "Recorded cumulative" : "Annual gross"} income chart. Use left and right arrow keys to inspect years.`}
        onKeyDown={(event) => {
          const next =
            event.key === "ArrowLeft"
              ? index - 1
              : event.key === "ArrowRight"
                ? index + 1
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? view.years.length - 1
                    : null;
          if (next != null) {
            event.preventDefault();
            setSelectedYear(
              view.years[Math.min(view.years.length - 1, Math.max(0, next))],
            );
          }
        }}
      >
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          onPointerDown={inspect}
          onPointerMove={(event) => {
            if (event.buttons > 0 || event.pointerType === "mouse")
              inspect(event);
          }}
        >
          {[layout.top, (layout.top + layout.bottom) / 2, layout.bottom].map(
            (y, index) => (
              <g key={y}>
                <line
                  x1="0"
                  x2={layout.width}
                  y1={y}
                  y2={y}
                  className="annual-chart-grid"
                />
                <text x={layout.width - 4} y={y - 4} textAnchor="end">
                  {compactMoney(
                    layout.high -
                      ((layout.high - layout.low || 100) * index) / 2,
                  )}
                </text>
              </g>
            ),
          )}
          <line
            x1="0"
            x2={layout.width}
            y1={layout.zero}
            y2={layout.zero}
            className="annual-chart-zero"
          />
          {layout.bands.map((band) => (
            <g key={band.key}>
              {band.segments.map((segment, index) => (
                <g key={index}>
                  <path d={segment.area} fill={band.color} fillOpacity=".22" />
                  <path
                    d={segment.top}
                    stroke={band.color}
                    fill="none"
                    strokeWidth="2"
                  />
                  {segment.points.map((point) => (
                    <circle
                      key={point.year}
                      cx={point.x}
                      cy={point.y}
                      r="3"
                      fill={band.color}
                    />
                  ))}
                </g>
              ))}
            </g>
          ))}
          {layout.lines
            .filter((line) => view.people.length === 1 || line.total)
            .map((line) => (
              <g key={line.key}>
                {line.segments.map((segment, index) => (
                  <g key={index}>
                    <path
                      d={segment.path}
                      stroke={line.color}
                      strokeWidth={line.total ? "2.5" : "1.7"}
                      fill="none"
                      strokeDasharray="5 4"
                    />
                    {segment.points.length === 1 && (
                      <circle
                        cx={segment.points[0].x}
                        cy={segment.points[0].y}
                        r="3"
                        stroke={line.color}
                        fill="var(--card)"
                      />
                    )}
                  </g>
                ))}
              </g>
            ))}
          <line
            x1={layout.x(index)}
            x2={layout.x(index)}
            y1={layout.top}
            y2={layout.bottom}
            className="annual-chart-cursor"
          />
          {layout.ticks.map((tick, index) => (
            <text
              key={tick}
              x={layout.x(tick)}
              y={layout.height - 6}
              textAnchor={
                index === 0
                  ? "start"
                  : index === layout.ticks.length - 1
                    ? "end"
                    : "middle"
              }
            >
              {view.years[tick]}
            </text>
          ))}
        </svg>
      </div>
      <div className="annual-chart-inspect">
        <label>
          Inspect year{" "}
          <select
            value={selectedYear}
            onChange={(event) => setSelectedYear(Number(event.target.value))}
          >
            {view.years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <div aria-live="polite" className="annual-chart-reading">
          <strong>
            {selectedYear} ·{" "}
            {running ? "Recorded running total" : "Gross income"}
          </strong>
          {view.actualSeries.map((series) => (
            <span key={series.key}>
              <i style={{ background: series.color }} />
              {series.label}:{" "}
              {knownAmount(series.values[selectedYear])
                ? money(series.values[selectedYear])
                : "Not recorded"}
            </span>
          ))}
          <strong>
            Recorded total:{" "}
            {knownAmount(actualTotal) ? money(actualTotal) : "Not recorded"}
          </strong>
          {view.rows.find((row) => row.year === selectedYear)?.missing_people >
            0 && (
            <small>
              Partial coverage ·{" "}
              {
                view.rows.find((row) => row.year === selectedYear)
                  .missing_people
              }{" "}
              {view.rows.find((row) => row.year === selectedYear)
                .missing_people === 1
                ? "person has"
                : "people have"}{" "}
              no annual record for this year.
            </small>
          )}
          {view.forecastSeries
            .filter((series) => knownAmount(series.values[selectedYear]))
            .map((series) => (
              <span key={series.key}>
                <i
                  className="annual-dashed-key"
                  style={{ borderColor: series.color }}
                />
                {series.label}: {money(series.values[selectedYear])}
              </span>
            ))}
          {forecast &&
            knownAmount(
              view.rows.find((row) => row.year === selectedYear)
                ?.forecast_cents,
            ) &&
            view.rows.find((row) => row.year === selectedYear)
              ?.forecast_missing_people > 0 && (
              <small>
                Forecast covers{" "}
                {
                  view.rows.find((row) => row.year === selectedYear)
                    .forecast_reported_people
                }
                /{view.people.length} people in this view.
              </small>
            )}
        </div>
      </div>
      <p className="annual-caption">
        Filled areas show recorded {running ? "cumulative " : "gross "}income.
        Missing years remain unknown; future actuals are not assumed.
        {forecast
          ? ` Dashed lines show the saved ${view.people.length > 1 ? "forecast total; choose a person to compare their individual forecast" : "forecast"}.`
          : ""}{" "}
        Totals include reported amounts only.
      </p>
      {forecastPeople.size > 0 && forecastPeople.size < view.people.length && (
        <p className="annual-caption">
          This forecast covers {forecastPeople.size}/{view.people.length} people
          in the chart. Additional people are outside this saved version; choose
          a person for a direct comparison.
        </p>
      )}
      {running && forecast?.baseline_source === "legacy_import_actuals" && (
        <p className="annual-caption">
          This imported forecast did not retain its original baseline. Running
          totals use the recorded income saved during import
          {forecast.baseline_recorded_at
            ? ` on ${new Date(forecast.baseline_recorded_at).toLocaleDateString()}`
            : ""}
          ; annual forecast amounts remain unchanged.
        </p>
      )}
    </div>
  );
}
