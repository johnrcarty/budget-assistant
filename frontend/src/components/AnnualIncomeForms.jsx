import { useEffect, useRef, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { Button, Field, Modal } from "./ui.jsx";
import { api } from "../lib/api.js";
import { colors, money } from "../lib/format.js";
import {
  annualEntryBody,
  annualPersonColor,
  knownAmount,
  withholdingFields,
} from "../lib/annual-income.js";
import { snapshotFromAnnualIncomeCsv } from "../lib/annual-income-csv.js";

const inputAmount = (value) => (value == null ? "" : (value / 100).toFixed(2));
const requestKey = () =>
  globalThis.crypto?.randomUUID?.() ||
  `annual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
function DialogStatus({ error, locked, onRefresh, busy }) {
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {locked && (
        <div className="annual-refresh-note">
          <p>
            The save needs verification. Refresh and inspect the records before
            making another change.
          </p>
          <Button
            type="button"
            variant="secondary"
            busy={busy}
            icon={RefreshCw}
            onClick={onRefresh}
          >
            Refresh records
          </Button>
        </div>
      )}
    </>
  );
}
export function AnnualEntryDialog({
  entry,
  people,
  currentYear,
  onSave,
  onDelete,
  onClose,
  busy,
  locked,
  error,
  onRefresh,
}) {
  const [localError, setLocalError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <Modal
      title={entry ? "Annual income record" : "Add annual income"}
      description="Gross income from a W-2, statement, or other annual record. Monthly paychecks stay in your budget."
      onClose={() => !busy && onClose()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setLocalError("");
          try {
            onSave(
              annualEntryBody(
                Object.fromEntries(new FormData(event.currentTarget)),
              ),
            );
          } catch (caught) {
            setLocalError(caught.message);
          }
        }}
      >
        <fieldset disabled={busy || locked} className="annual-fieldset">
          <div className="form-grid">
            <Field label="Person">
              <select
                name="person_id"
                defaultValue={
                  entry?.person_id ||
                  people.find((person) => person.active)?.id ||
                  ""
                }
                required
              >
                <option value="" disabled>
                  Choose a person
                </option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                    {!person.active ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Year">
              <input
                name="year"
                type="number"
                min="1900"
                max="2200"
                step="1"
                defaultValue={entry?.year ?? currentYear - 1}
                required
              />
            </Field>
            <Field label="Source">
              <input
                name="source"
                maxLength="40"
                defaultValue={entry?.source || "W-2"}
                placeholder="Employer, W-2, or other source"
                required
              />
            </Field>
            <Field label="Gross income (USD)">
              <input
                name="amount"
                inputMode="decimal"
                defaultValue={inputAmount(entry?.amount_cents)}
                placeholder="0.00"
                required
              />
            </Field>
          </div>
          <details
            className="annual-withholding"
            open={
              entry && withholdingFields.some(([key]) => entry[key] != null)
            }
          >
            <summary>
              Withholding and taxes <span>Optional</span>
            </summary>
            <p>
              Leave unknown amounts blank. Enter a negative amount for an
              adjustment or refund.
            </p>
            <div className="form-grid">
              {withholdingFields.map(([key, label]) => (
                <Field key={key} label={`${label} (USD)`}>
                  <input
                    name={key}
                    inputMode="decimal"
                    defaultValue={inputAmount(entry?.[key])}
                    placeholder="Not recorded"
                  />
                </Field>
              ))}
            </div>
          </details>
          <Field label="Notes">
            <textarea
              name="note"
              maxLength="2000"
              defaultValue={entry?.note || ""}
              rows="2"
            />
          </Field>
        </fieldset>
        <DialogStatus
          error={localError || error}
          locked={locked}
          onRefresh={onRefresh}
          busy={busy}
        />
        <div className="modal-actions annual-form-actions">
          {entry && !confirmDelete && (
            <Button
              type="button"
              variant="ghost"
              icon={Trash2}
              disabled={busy || locked}
              onClick={() => setConfirmDelete(true)}
            >
              Remove record
            </Button>
          )}
          {entry && confirmDelete && (
            <Button
              type="button"
              variant="danger"
              icon={Trash2}
              disabled={busy || locked}
              onClick={onDelete}
            >
              Confirm removal
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" busy={busy} disabled={locked || busy}>
            Save record
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function AnnualPeopleDialog({
  people,
  onSave,
  onClose,
  busy,
  locked,
  error,
  onRefresh,
}) {
  const [selection, setSelection] = useState("new");
  const [localError, setLocalError] = useState("");
  const person = people.find((row) => row.id === Number(selection));
  return (
    <Modal
      title="People in the tracker"
      description="These labels organize annual income. They do not change user access or budget privacy."
      onClose={() => !busy && onClose()}
    >
      <Field label="Person">
        <select
          value={selection}
          disabled={busy || locked}
          onChange={(event) => {
            setSelection(event.target.value);
            setLocalError("");
          }}
        >
          <option value="new">Add a person</option>
          {people.map((row) => (
            <option value={row.id} key={row.id}>
              {row.name}
              {!row.active ? " (archived)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <form
        key={selection}
        onSubmit={(event) => {
          event.preventDefault();
          const values = Object.fromEntries(new FormData(event.currentTarget));
          const name = String(values.name || "").trim();
          if (!name) {
            setLocalError("Enter a name.");
            return;
          }
          setLocalError("");
          onSave(person?.id, {
            name,
            color: values.color,
            sort_order: person?.sort_order ?? people.length,
            active: values.active === "on",
          });
        }}
      >
        <fieldset className="annual-fieldset" disabled={busy || locked}>
          <div className="form-grid">
            <Field label="Name">
              <input
                name="name"
                defaultValue={person?.name || ""}
                maxLength="80"
                required
              />
            </Field>
            <Field label="Chart color">
              <input
                name="color"
                type="color"
                defaultValue={
                  person
                    ? annualPersonColor(person, people.indexOf(person))
                    : colors[people.length % colors.length]
                }
              />
            </Field>
          </div>
          <label className="checkbox-field">
            <input
              name="active"
              type="checkbox"
              defaultChecked={person?.active ?? true}
            />
            Active person
          </label>
          <p className="annual-caption">
            Archived people keep their income records and saved forecasts.
          </p>
        </fieldset>
        <DialogStatus
          error={localError || error}
          locked={locked}
          onRefresh={onRefresh}
          busy={busy}
        />
        <div className="modal-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button busy={busy} disabled={locked || busy} type="submit">
            {person ? "Save person" : "Add person"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function forecastBody(values) {
  const base_year = Number(values.base_year),
    horizon_year = Number(values.horizon_year);
  if (!values.name.trim()) throw new Error("Name the forecast.");
  if (
    !Number.isInteger(base_year) ||
    base_year < 1900 ||
    base_year > 2200 ||
    !Number.isInteger(horizon_year) ||
    horizon_year <= base_year ||
    horizon_year > 2300
  )
    throw new Error("Choose a final year after the baseline year, up to 2300.");
  const params =
    values.model === "pattern"
      ? {
          ratesBps: values.rates.split(",").map((rate) => {
            const text = rate.trim();
            if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(text))
              throw new Error(
                "Enter a comma-separated pattern of percentages, such as 3.5, 3.5, 3.5, 10.",
              );
            const number = Math.round(Number(text) * 100);
            if (
              !Number.isSafeInteger(number) ||
              number < -10000 ||
              number > 100000
            )
              throw new Error(
                "Each growth rate must be between -100% and 1,000%.",
              );
            return number;
          }),
        }
      : {};
  if (
    params.ratesBps &&
    (!params.ratesBps.length || params.ratesBps.length > 50)
  )
    throw new Error("Use between one and 50 rates in the pattern.");
  return {
    name: values.name.trim(),
    model: values.model,
    params,
    base_year,
    horizon_year,
  };
}
export function AnnualForecastDialog({
  scope,
  data,
  onSave,
  onClose,
  busy,
  locked,
  error,
  onRefresh,
}) {
  const years = [...new Set(data.actuals.map((row) => row.year))].sort(
    (a, b) => b - a,
  );
  const baseYear = Math.max(
    1900,
    Math.min(2200, years[0] || data.current_year - 1),
  );
  const [values, setValues] = useState({
    name: `Forecast from ${baseYear}`,
    model: "pattern",
    base_year: String(baseYear),
    horizon_year: String(
      Math.min(2300, Math.max(data.current_year + 10, baseYear + 1)),
    ),
    rates: "3.5, 3.5, 3.5, 10",
  });
  const [preview, setPreview] = useState(null),
    [previewBusy, setPreviewBusy] = useState(false),
    [localError, setLocalError] = useState("");
  const sequence = useRef(0),
    mounted = useRef(true),
    createKey = useRef(requestKey());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  const change = (key, value) => {
    sequence.current++;
    setPreviewBusy(false);
    setValues((current) => ({ ...current, [key]: value }));
    setPreview(null);
    setLocalError("");
    createKey.current = requestKey();
  };
  async function review(event) {
    event.preventDefault();
    if (busy || locked || previewBusy) return;
    setLocalError("");
    const current = ++sequence.current;
    let body;
    try {
      body = forecastBody(values);
    } catch (caught) {
      setLocalError(caught.message);
      return;
    }
    setPreviewBusy(true);
    setPreview(null);
    try {
      const result = await api(
        `annual-income/forecasts/preview?scope=${scope}`,
        { method: "POST", body },
      );
      if (mounted.current && current === sequence.current)
        setPreview({ result, body });
    } catch (caught) {
      if (mounted.current && current === sequence.current)
        setLocalError(caught.message);
    } finally {
      if (mounted.current && current === sequence.current)
        setPreviewBusy(false);
    }
  }
  const firstYear = preview?.result.points?.length
    ? Math.min(...preview.result.points.map((point) => point.year))
    : null;
  const lastYear = preview?.result.points?.length
    ? Math.max(...preview.result.points.map((point) => point.year))
    : null;
  return (
    <Modal
      title="Create a saved forecast"
      description="Preview the result, then save a fixed comparison. Later income edits will not rewrite it."
      onClose={() => !busy && onClose()}
    >
      <form onSubmit={review}>
        <fieldset
          className="annual-fieldset"
          disabled={busy || locked || previewBusy}
        >
          <Field label="Name">
            <input
              value={values.name}
              onChange={(event) => change("name", event.target.value)}
              maxLength="80"
              required
            />
          </Field>
          <div className="form-grid">
            <Field label="Model">
              <select
                value={values.model}
                onChange={(event) => change("model", event.target.value)}
              >
                <option value="pattern">Repeating growth pattern</option>
                <option value="linear_regression">Linear trend</option>
              </select>
            </Field>
            <Field label="Baseline year">
              <input
                type="number"
                min="1900"
                max="2200"
                step="1"
                value={values.base_year}
                onChange={(event) => change("base_year", event.target.value)}
                required
              />
            </Field>
          </div>
          {values.model === "pattern" && (
            <Field
              label="Repeating growth rates (%)"
              help="Applied in order after the latest reported year, then repeated."
            >
              <input
                value={values.rates}
                onChange={(event) => change("rates", event.target.value)}
                placeholder="3.5, 3.5, 3.5, 10"
                required
              />
            </Field>
          )}
          {values.model === "linear_regression" && (
            <p className="annual-caption">
              A straight-line trend based on each person's recorded annual
              income through the baseline year.
            </p>
          )}
          <Field label="Final forecast year">
            <input
              type="number"
              min="1901"
              max="2300"
              step="1"
              value={values.horizon_year}
              onChange={(event) => change("horizon_year", event.target.value)}
              required
            />
          </Field>
        </fieldset>
        {preview && (
          <section className="annual-preview" aria-label="Forecast preview">
            <strong>
              {preview.body.name} · {firstYear}–{lastYear}
            </strong>
            <p>
              {preview.result.points?.length || 0} saved person/year
              predictions. The income recorded through {preview.body.base_year}{" "}
              will be saved as the running-total baseline.
            </p>
            <div className="annual-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>{firstYear}</th>
                    <th>{lastYear}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((person) => {
                    const points = preview.result.points.filter(
                      (point) => point.person_id === person.id,
                    );
                    if (!points.length) return null;
                    const first = points.find(
                        (point) => point.year === firstYear,
                      )?.amount_cents,
                      last = points.find(
                        (point) => point.year === lastYear,
                      )?.amount_cents;
                    return (
                      <tr key={person.id}>
                        <th>{person.name}</th>
                        <td>{knownAmount(first) ? money(first) : "—"}</td>
                        <td>{knownAmount(last) ? money(last) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <DialogStatus
          error={localError || error}
          locked={locked}
          onRefresh={onRefresh}
          busy={busy}
        />
        <div className="modal-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant={preview ? "secondary" : ""}
            busy={previewBusy}
            disabled={busy || locked || previewBusy}
          >
            Preview forecast
          </Button>
          {preview && (
            <Button
              type="button"
              busy={busy}
              disabled={locked || previewBusy || busy}
              onClick={() =>
                onSave({
                  ...preview.body,
                  input_fingerprint: preview.result.input_fingerprint,
                  idempotency_key: createKey.current,
                })
              }
            >
              Save forecast
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}

export function AnnualImportDialog({
  scope,
  people,
  onSave,
  onClose,
  busy,
  locked,
  error,
  onRefresh,
}) {
  const [snapshot, setSnapshot] = useState(null),
    [filename, setFilename] = useState(""),
    [resolutions, setResolutions] = useState({}),
    [preview, setPreview] = useState(null),
    [reading, setReading] = useState(false),
    [localError, setLocalError] = useState("");
  const sequence = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  async function readFile(event) {
    const file = event.target.files?.[0];
    const current = ++sequence.current;
    setSnapshot(null);
    setResolutions({});
    setPreview(null);
    setLocalError("");
    setFilename(file?.name || "");
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setLocalError("Choose a file smaller than 8 MB.");
      return;
    }
    setReading(true);
    try {
      const text = await file.text();
      const result = /\.csv$/i.test(file.name)
        ? await snapshotFromAnnualIncomeCsv(text, file.name)
        : JSON.parse(text);
      if (
        !Array.isArray(result.people) ||
        !Array.isArray(result.entries) ||
        !Array.isArray(result.forecasts)
      )
        throw new Error(
          "Choose an annual income snapshot JSON or supported income CSV.",
        );
      if (mounted.current && current === sequence.current) setSnapshot(result);
    } catch (caught) {
      if (mounted.current && current === sequence.current)
        setLocalError(caught.message || "Could not read this file.");
    } finally {
      if (mounted.current && current === sequence.current) setReading(false);
    }
  }
  async function review() {
    if (busy || locked || reading || !snapshot) return;
    const current = ++sequence.current;
    setReading(true);
    setLocalError("");
    setPreview(null);
    const body = { snapshot, person_resolutions: resolutions };
    try {
      const result = await api(
        `annual-income/snapshot/preview?scope=${scope}`,
        { method: "POST", body },
      );
      if (mounted.current && current === sequence.current)
        setPreview({ result, body });
    } catch (caught) {
      if (mounted.current && current === sequence.current)
        setLocalError(caught.message);
    } finally {
      if (mounted.current && current === sequence.current) setReading(false);
    }
  }
  return (
    <Modal
      title="Import annual income"
      description="Review a tracker snapshot or income CSV before adding its records to this budget scope."
      onClose={() => !busy && onClose()}
    >
      <fieldset
        className="annual-fieldset"
        disabled={busy || locked || reading}
      >
        <Field label="JSON snapshot or CSV file">
          <input
            type="file"
            accept=".json,.csv,application/json,text/csv"
            onChange={readFile}
          />
        </Field>
        <p className="annual-caption">
          Snapshots retain stable record and forecast IDs. CSV replay protects
          only the exact same file; a changed CSV is a new import and may
          duplicate existing records.
        </p>
        {snapshot && (
          <div className="annual-import-people">
            <strong>{filename}</strong>
            <p>
              {snapshot.entries.length} records · {snapshot.forecasts.length}{" "}
              saved forecasts
            </p>
            {snapshot.people.map((person) => (
              <Field key={person.id} label={`Import ${person.name} as`}>
                <select
                  value={resolutions[String(person.id)] || "new"}
                  onChange={(event) => {
                    setPreview(null);
                    setResolutions((current) => {
                      const next = { ...current };
                      if (event.target.value === "new")
                        delete next[String(person.id)];
                      else next[String(person.id)] = Number(event.target.value);
                      return next;
                    });
                  }}
                >
                  <option value="new">Create or match imported identity</option>
                  {people.map((existing) => (
                    <option key={existing.id} value={existing.id}>
                      {existing.name}
                      {!existing.active ? " (archived)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
        )}
      </fieldset>
      {preview && (
        <section className="annual-preview" aria-label="Import review">
          <strong>
            {preview.result.can_import
              ? "Ready to import"
              : "Resolve these conflicts"}
          </strong>
          <p>
            {preview.result.summary.people_to_create} people ·{" "}
            {preview.result.summary.entries_to_import} records ·{" "}
            {preview.result.summary.forecasts_to_import} forecasts to add.{" "}
            {preview.result.summary.already_imported} already imported.
          </p>
          {preview.result.conflicts?.length > 0 && (
            <ul>
              {preview.result.conflicts.map((conflict, index) => (
                <li key={index}>{conflict.message}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <DialogStatus
        error={localError || error}
        locked={locked}
        onRefresh={onRefresh}
        busy={busy}
      />
      <div className="modal-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          busy={reading}
          disabled={!snapshot || busy || locked || reading}
          onClick={review}
        >
          Review import
        </Button>
        {preview?.result.can_import && (
          <Button
            type="button"
            busy={busy}
            disabled={locked || reading || busy}
            onClick={() =>
              onSave({
                ...preview.body,
                input_fingerprint: preview.result.input_fingerprint,
              })
            }
          >
            Import reviewed records
          </Button>
        )}
      </div>
    </Modal>
  );
}
