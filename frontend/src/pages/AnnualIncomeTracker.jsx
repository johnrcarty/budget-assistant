import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { api } from "../lib/api.js";
import { money, thisMonth } from "../lib/format.js";
import {
  annualIncomeView,
  knownAmount,
  withholdingFields,
} from "../lib/annual-income.js";
import { Button, IconButton } from "../components/ui.jsx";
import AnnualIncomeChart from "../components/AnnualIncomeChart.jsx";
import {
  AnnualEntryDialog,
  AnnualForecastDialog,
  AnnualImportDialog,
  AnnualPeopleDialog,
} from "../components/AnnualIncomeForms.jsx";

const amountLabel = (value) => (knownAmount(value) ? money(value) : "—");
const forecastModelLabel = (model) =>
  model === "pattern"
    ? "Growth pattern"
    : model === "linear_regression"
      ? "Linear trend"
      : `Imported model${model ? `: ${model}` : ""}`;
const savedDateLabel = (value) =>
  value && Number.isFinite(new Date(value).getTime())
    ? new Date(value).toLocaleDateString()
    : "Unknown save date";
function annualQuery(scope, throughYear, forecastId) {
  return `scope=${encodeURIComponent(scope)}&through_year=${throughYear}${forecastId === "latest" ? "" : `&forecast_id=${encodeURIComponent(forecastId)}`}`;
}
export default function AnnualIncomeTracker({ scope, user, notify }) {
  const initialYear = Number(thisMonth(user?.timezone).slice(0, 4));
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState("");
  const [personId, setPersonId] = useState("all"),
    [forecastId, setForecastId] = useState("latest"),
    [running, setRunning] = useState(false),
    [future, setFuture] = useState(false),
    [futureYear, setFutureYear] = useState(initialYear + 10);
  const [dialog, setDialog] = useState(null),
    [writing, setWriting] = useState(false),
    [locked, setLocked] = useState(false),
    [formError, setFormError] = useState(""),
    [exporting, setExporting] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const sequence = useRef(0),
    mounted = useRef(true),
    loadedQuery = useRef(null);
  const currentYear = data?.current_year ?? initialYear;
  const throughYear = future ? futureYear : currentYear;
  const query = annualQuery(scope, throughYear, forecastId);
  const mutationBusy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  async function reload(targetQuery = query) {
    const request = ++sequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const result = await api(`annual-income?${targetQuery}`);
      if (!mounted.current || request !== sequence.current) return false;
      setData(result);
      loadedQuery.current = targetQuery;
      return true;
    } catch (caught) {
      if (mounted.current && request === sequence.current)
        setLoadError(caught.message);
      return false;
    } finally {
      if (mounted.current && request === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (loadedQuery.current !== query) reload(query);
  }, [query]);
  const fresh = loadedQuery.current === query && !loadError;
  const disabled = writing || locked || loading || !fresh;
  const view = useMemo(
    () =>
      data
        ? annualIncomeView(data, {
            personId,
            running,
            currentYear: data.current_year,
            future: data.through_year > data.current_year,
          })
        : null,
    [data, personId, running],
  );
  function open(kind, item) {
    if (disabled) return;
    setFormError("");
    setConfirmDelete(false);
    setDialog({ kind, item });
  }
  async function save(path, method, body, options = {}) {
    if (disabled || mutationBusy.current) return;
    mutationBusy.current = true;
    setWriting(true);
    setFormError("");
    let acknowledged = false;
    try {
      const result = await api(`${path}?scope=${scope}`, { method, body });
      acknowledged = true;
      if (!mounted.current) return;
      const nextId = options.createdForecast
        ? String(result.id)
        : options.deletedForecast
          ? "none"
          : forecastId;
      const nextQuery = annualQuery(scope, throughYear, nextId);
      const refreshed = await reload(nextQuery);
      if (!mounted.current) return;
      if (!refreshed) {
        setLocked(true);
        setFormError(
          "The change was saved, but the updated records could not be loaded.",
        );
        return;
      }
      if (nextId !== forecastId) setForecastId(nextId);
      setDialog(null);
      setConfirmDelete(false);
      notify?.(options.message || "Annual income tracker updated.");
    } catch (caught) {
      if (!mounted.current) return;
      if (acknowledged || caught.outcomeUnknown) {
        setLocked(true);
        setFormError(
          acknowledged
            ? "The change was saved. Refresh the records to verify it."
            : "The save returned no confirmed result. Refresh the records before making another change.",
        );
      } else setFormError(caught.message);
    } finally {
      mutationBusy.current = false;
      if (mounted.current) setWriting(false);
    }
  }
  async function refresh() {
    if (writing || loading) return;
    const nextId = locked ? "latest" : forecastId;
    const success = await reload(annualQuery(scope, throughYear, nextId));
    if (success && mounted.current) {
      setForecastId(nextId);
      setLocked(false);
      setFormError("");
      setDialog(null);
      notify?.(
        "Annual records refreshed. Review the list before adding another record.",
      );
    }
  }
  async function exportSnapshot() {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await api(`annual-income/snapshot?scope=${scope}`);
      if (!mounted.current) return;
      const blob = new Blob([`${JSON.stringify(result, null, 2)}\n`], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `budget-annual-income-${scope}-${thisMonth(user?.timezone)}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (caught) {
      if (mounted.current) setLoadError(caught.message);
    } finally {
      if (mounted.current) setExporting(false);
    }
  }
  const people = data?.people || [];
  const entries = (data?.entries || [])
    .filter(
      (entry) => personId === "all" || entry.person_id === Number(personId),
    )
    .sort(
      (a, b) =>
        b.year - a.year ||
        a.person_id - b.person_id ||
        a.source.localeCompare(b.source) ||
        a.id - b.id,
    );
  const selectedForecast = data?.selected_forecast;
  const recordYears = [...new Set(entries.map((entry) => entry.year))];
  const dialogProps = {
    busy: writing,
    locked,
    error: formError,
    onRefresh: refresh,
    onClose: () => !writing && setDialog(null),
  };
  return (
    <div className="annual-tracker">
      <section className="annual-panel">
        <div className="annual-heading">
          <div>
            <h2>Annual income</h2>
            <p>Gross income by person, with forecasts saved over time.</p>
          </div>
          <div className="annual-actions">
            <Button
              icon={Plus}
              disabled={disabled || !people.length}
              onClick={() => open("entry")}
            >
              Add record
            </Button>
            <Button
              variant="secondary"
              icon={Users}
              disabled={disabled}
              onClick={() => open("people")}
            >
              People
            </Button>
          </div>
        </div>
        {loadError && (
          <div className="error-banner" role="alert">
            <p>
              {loadError}
              {data ? " Previously loaded records are still shown." : ""}
            </p>
            <Button
              variant="ghost"
              icon={RefreshCw}
              onClick={refresh}
              disabled={loading || writing}
            >
              Retry
            </Button>
          </div>
        )}
        {locked && (
          <div className="annual-refresh-note" role="alert">
            <p>
              {formError || "Refresh the records before making another change."}
            </p>
            <Button
              icon={RefreshCw}
              variant="secondary"
              onClick={refresh}
              busy={loading}
            >
              Refresh records
            </Button>
          </div>
        )}
        {!dialog && formError && !locked && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <div className="annual-controls">
          <label>
            Person
            <select
              value={personId}
              disabled={loading || writing}
              onChange={(event) => setPersonId(event.target.value)}
            >
              <option value="all">All people</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                  {!person.active ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Saved forecast
            <select
              value={forecastId}
              disabled={loading || writing || locked}
              onChange={(event) => {
                setForecastId(event.target.value);
                setConfirmDelete(false);
              }}
            >
              <option value="latest">Newest saved forecast</option>
              <option value="none">Actuals only</option>
              {data?.forecasts?.map((forecast) => (
                <option key={forecast.id} value={forecast.id}>
                  {forecast.name} · baseline {forecast.base_year}
                </option>
              ))}
            </select>
          </label>
          <div
            className="annual-mode"
            role="group"
            aria-label="Income chart view"
          >
            <button
              type="button"
              aria-pressed={!running}
              className={!running ? "selected" : ""}
              onClick={() => setRunning(false)}
            >
              By year
            </button>
            <button
              type="button"
              aria-pressed={running}
              className={running ? "selected" : ""}
              onClick={() => setRunning(true)}
            >
              Running total
            </button>
          </div>
          <label className="checkbox-field annual-future">
            <input
              type="checkbox"
              checked={future}
              disabled={loading || writing || locked}
              onChange={(event) => {
                if (event.target.checked)
                  setFutureYear(
                    Math.max(
                      currentYear,
                      Math.min(
                        2300,
                        selectedForecast?.horizon_year || currentYear + 10,
                      ),
                    ),
                  );
                setFuture(event.target.checked);
              }}
            />
            Show future projection
          </label>
          {future && (
            <label className="annual-end-year">
              Through year
              <select
                value={futureYear}
                disabled={loading || writing || locked}
                onChange={(event) => setFutureYear(Number(event.target.value))}
              >
                {Array.from(
                  { length: Math.max(1, 2300 - currentYear + 1) },
                  (_value, index) => currentYear + index,
                ).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {loading && !data ? (
          <div className="loading-state">
            <LoaderCircle className="spinning" size={24} />
            <p>Loading annual income…</p>
          </div>
        ) : (
          view && (
            <>
              <div className="annual-chart-heading">
                <span>
                  {selectedForecast
                    ? `${selectedForecast.name} · baseline ${selectedForecast.base_year}`
                    : "Recorded actuals"}
                </span>
                <span>
                  USD · through {data.through_year}
                  {loading ? " · updating…" : ""}
                </span>
              </div>
              <AnnualIncomeChart
                view={view}
                running={running}
                forecast={selectedForecast}
              />
              {!entries.length && (
                <p className="annual-empty-note">
                  Add the people and their annual income records, or import your
                  previous tracker. Missing records remain unknown.
                </p>
              )}
            </>
          )
        )}
        <div className="annual-tools">
          <Button
            variant="ghost"
            icon={Plus}
            disabled={disabled || !data?.actuals?.length}
            onClick={() => open("forecast")}
          >
            Save a new forecast
          </Button>
          <Button
            variant="ghost"
            icon={Upload}
            disabled={disabled}
            onClick={() => open("import")}
          >
            Import
          </Button>
          <Button
            variant="ghost"
            icon={Download}
            busy={exporting}
            disabled={!data || writing || locked || loading || exporting}
            onClick={exportSnapshot}
          >
            Export snapshot
          </Button>
          <IconButton
            label="Refresh annual income"
            disabled={writing || loading}
            onClick={refresh}
          >
            <RefreshCw size={17} />
          </IconButton>
        </div>
        {selectedForecast && (
          <div className="annual-forecast-meta">
            <span>
              {selectedForecast.created_at
                ? `Saved ${savedDateLabel(selectedForecast.created_at)}`
                : "Unknown save date"}{" "}
              · {forecastModelLabel(selectedForecast.model)} ·{" "}
              {selectedForecast.base_year + 1}–{selectedForecast.horizon_year}
            </span>
            <Button
              variant="ghost"
              icon={Trash2}
              disabled={disabled}
              onClick={() =>
                confirmDelete
                  ? save(
                      `annual-income/forecasts/${selectedForecast.id}`,
                      "DELETE",
                      undefined,
                      {
                        deletedForecast: true,
                        message: "Saved forecast removed.",
                      },
                    )
                  : setConfirmDelete(true)
              }
            >
              {confirmDelete ? "Confirm removal" : "Remove forecast"}
            </Button>
            {confirmDelete && (
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            )}
          </div>
        )}
      </section>
      {view?.rows.length > 0 && (
        <section className="annual-panel">
          <div className="annual-section-heading">
            <h3>Year by year</h3>
            <span>Annual gross amounts</span>
          </div>
          <p className="annual-caption">
            A dash means no record. Reported totals may cover only part of the
            household.
            {selectedForecast
              ? " Forecast amounts come from the selected saved version."
              : ""}
          </p>
          <div className="annual-table-wrap">
            <table className="annual-year-table">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  {view.people.map((person) => (
                    <th scope="col" key={person.id}>
                      {person.name}
                    </th>
                  ))}
                  <th scope="col">Reported total</th>
                  {selectedForecast && (
                    <>
                      <th scope="col">Forecast total</th>
                      <th scope="col">Difference</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {[...view.rows].reverse().map((row) => (
                  <tr
                    key={row.year}
                    className={
                      row.year > data.current_year ? "annual-future-row" : ""
                    }
                  >
                    <th scope="row">
                      {row.year}
                      {row.year > data.current_year && <small>Projected</small>}
                    </th>
                    {view.people.map((person, index) => (
                      <td key={person.id}>
                        <span>{amountLabel(row.actual[index])}</span>
                        {knownAmount(row.projected[index]) && (
                          <small>Forecast {money(row.projected[index])}</small>
                        )}
                      </td>
                    ))}
                    <td>
                      <strong>{amountLabel(row.actual_cents)}</strong>
                      {knownAmount(row.actual_cents) &&
                        row.missing_people > 0 && (
                          <small>
                            Partial · {row.reported_people}/{view.people.length}{" "}
                            people
                          </small>
                        )}
                    </td>
                    {selectedForecast && (
                      <>
                        <td>
                          {amountLabel(row.forecast_cents)}
                          {knownAmount(row.forecast_cents) &&
                            row.forecast_missing_people > 0 && (
                              <small>
                                Partial · {row.forecast_reported_people}/
                                {view.people.length} people
                              </small>
                            )}
                        </td>
                        <td>
                          {knownAmount(row.difference_cents)
                            ? `${row.difference_cents > 0 ? "+" : ""}${money(row.difference_cents)}`
                            : "—"}
                          {knownAmount(row.difference_cents) &&
                            row.comparison_people < view.people.length && (
                              <small>
                                {row.comparison_people}/{view.people.length}{" "}
                                people compared
                              </small>
                            )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {data && (
        <section className="annual-panel">
          <div className="annual-section-heading">
            <h3>Income records</h3>
            <span>
              {entries.length} {entries.length === 1 ? "record" : "records"}
            </span>
          </div>
          <div className="annual-records">
            {recordYears.map((year) => (
              <details
                key={year}
                className="annual-record-year-group"
                open={year === recordYears[0]}
              >
                <summary>
                  <span>
                    {year}{" "}
                    <small>
                      {entries.filter((entry) => entry.year === year).length}{" "}
                      records
                    </small>
                  </span>
                  <strong>
                    {money(
                      entries
                        .filter((entry) => entry.year === year)
                        .reduce((sum, entry) => sum + entry.amount_cents, 0),
                    )}
                  </strong>
                </summary>
                {entries
                  .filter((entry) => entry.year === year)
                  .map((entry) => {
                    const person = people.find(
                      (row) => row.id === entry.person_id,
                    );
                    const taxKnown = withholdingFields.filter(
                      ([key]) => entry[key] != null,
                    ).length;
                    const withheld = withholdingFields.reduce(
                      (sum, [key]) => sum + (entry[key] || 0),
                      0,
                    );
                    return (
                      <button
                        type="button"
                        className="annual-record"
                        key={entry.id}
                        disabled={disabled}
                        onClick={() => open("entry", entry)}
                      >
                        <span className="annual-record-name">
                          <strong>
                            {person?.name || "Person"} · {entry.source}
                          </strong>
                          <small>
                            {taxKnown
                              ? `${money(withheld)} recorded withholding${taxKnown < withholdingFields.length ? " · incomplete" : ""}`
                              : "Withholding not recorded"}
                            {entry.note ? ` · ${entry.note}` : ""}
                          </small>
                        </span>
                        <strong>{money(entry.amount_cents)}</strong>
                      </button>
                    );
                  })}
              </details>
            ))}
            {!entries.length && (
              <p className="annual-caption">No annual records in this view.</p>
            )}
          </div>
        </section>
      )}
      {dialog?.kind === "entry" && (
        <AnnualEntryDialog
          {...dialogProps}
          entry={dialog.item}
          people={people}
          currentYear={currentYear}
          onSave={(body) =>
            save(
              `annual-income/entries${dialog.item ? `/${dialog.item.id}` : ""}`,
              dialog.item ? "PATCH" : "POST",
              body,
            )
          }
          onDelete={() =>
            save(`annual-income/entries/${dialog.item.id}`, "DELETE")
          }
        />
      )}
      {dialog?.kind === "people" && (
        <AnnualPeopleDialog
          {...dialogProps}
          people={people}
          onSave={(id, body) =>
            save(
              `annual-income/people${id ? `/${id}` : ""}`,
              id ? "PATCH" : "POST",
              body,
            )
          }
        />
      )}
      {dialog?.kind === "forecast" && (
        <AnnualForecastDialog
          {...dialogProps}
          scope={scope}
          data={data}
          onSave={(body) =>
            save("annual-income/forecasts", "POST", body, {
              createdForecast: true,
              message: "Forecast saved with its current income baseline.",
            })
          }
        />
      )}
      {dialog?.kind === "import" && (
        <AnnualImportDialog
          {...dialogProps}
          scope={scope}
          people={people}
          onSave={(body) =>
            save("annual-income/snapshot/import", "POST", body, {
              message: "Reviewed annual income records imported.",
            })
          }
        />
      )}
    </div>
  );
}
