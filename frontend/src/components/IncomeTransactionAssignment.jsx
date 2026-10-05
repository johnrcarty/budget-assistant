import { useEffect, useRef, useState } from "react";
import { Link2, RefreshCw } from "lucide-react";
import { api } from "../lib/api.js";
import { cents, money, monthLabel, prettyDate } from "../lib/format.js";
import { incomeCreationRequest } from "../lib/transactions.js";
import { Button, Field } from "./ui.jsx";

export default function IncomeTransactionAssignment({
  transaction,
  income,
  scope,
  month,
  busy,
  onSaved,
  onChanged,
  onBusyChange,
  onRefreshRequiredChange,
  draftChanged,
}) {
  const [targetMonth, setTargetMonth] = useState(
    transaction.income_month || transaction.date.slice(0, 7) || month,
  );
  const [available, setAvailable] = useState(
    (transaction.income_month || transaction.date.slice(0, 7)) !== month
      ? []
      : income.entries || [],
  );
  const [selection, setSelection] = useState(
    transaction.income_entry_id ? String(transaction.income_entry_id) : "",
  );
  const [replace, setReplace] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [lookupRevision, setLookupRevision] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [refreshRequired, setRefreshRequired] = useState(false);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const creationRequest = useRef(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  useEffect(() => {
    const request = ++sequence.current;
    setError("");
    setLookupFailed(false);
    if (targetMonth === month) {
      setAvailable(income.entries || []);
      setLoading(false);
      return;
    }
    setLoading(true);
    api(`income?scope=${scope}&month=${targetMonth}`)
      .then((result) => {
        if (mounted.current && request === sequence.current)
          setAvailable(result.entries || []);
      })
      .catch((e) => {
        if (mounted.current && request === sequence.current) {
          setAvailable([]);
          setLookupFailed(true);
          setError(e.message);
        }
      })
      .finally(() => {
        if (mounted.current && request === sequence.current) setLoading(false);
      });
  }, [scope, targetMonth, month, income, lookupRevision]);
  const linked = transaction.income_entry_id != null;
  const ordinary =
    (transaction.transaction_role ||
      transaction.effective_provider_role ||
      "ordinary") === "ordinary";
  const eligible =
    ordinary &&
    !transaction.account_unavailable &&
    transaction.amount_cents > 0 &&
    (transaction.currency || "USD") === "USD";
  const replacing =
    selection &&
    selection !== "unlink" &&
    ((linked &&
      (selection === "new" ||
        Number(selection) !== transaction.income_entry_id)) ||
      transaction.category_id != null);
  const locked = busy || working || refreshRequired;
  const receiptLabel = transaction.income_link_invalid
    ? "Review receipt"
    : transaction.pending
      ? "Pending receipt"
      : "Received";
  const lastDate = `${targetMonth}-${String(new Date(Number(targetMonth.slice(0, 4)), Number(targetMonth.slice(5, 7)), 0).getDate()).padStart(2, "0")}`;
  async function save(event) {
    event.preventDefault();
    if (
      locked ||
      loading ||
      !selection ||
      ((lookupFailed || draftChanged) && selection !== "unlink")
    )
      return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const body =
      selection === "unlink"
        ? { entry_id: null, create_entry: null }
        : selection === "new"
          ? {
              create_entry: {
                name: values.income_name,
                amount_cents: cents(values.expected_amount),
                date: values.income_date,
              },
              replace_existing: replace,
            }
          : { entry_id: Number(selection), replace_existing: replace };
    setWorking(true);
    onBusyChange?.(true);
    setError("");
    let saved = false;
    try {
      if (selection === "new") {
        creationRequest.current = incomeCreationRequest(
          creationRequest.current,
          body,
          { scope, month: targetMonth, transaction_id: transaction.id },
        );
        body.idempotency_key = creationRequest.current.key;
      }
      const result = await api(
        `transactions/${transaction.id}/income?scope=${scope}&month=${targetMonth}`,
        { method: "PUT", body },
      );
      saved = true;
      creationRequest.current = null;
      if (!mounted.current) {
        await onChanged();
        return;
      }
      onSaved(result);
      const refreshed = await onChanged();
      if (!mounted.current) return;
      setSelection(
        result.income_entry_id ? String(result.income_entry_id) : "",
      );
      setReplace(false);
      if (refreshed === false) {
        setRefreshRequired(true);
        onRefreshRequiredChange?.(true);
        setError(
          "Income assignment saved. Refresh before making another change.",
        );
      }
    } catch (e) {
      if (mounted.current) {
        if (saved || e.outcomeUnknown) {
          setRefreshRequired(true);
          onRefreshRequiredChange?.(true);
          setError(
            saved
              ? "Income assignment saved. Refresh before making another change."
              : "The income change could not be confirmed. Refresh to check its status before making another change.",
          );
        } else setError(e.message);
      }
    } finally {
      if (mounted.current) {
        setWorking(false);
        onBusyChange?.(false);
      }
    }
  }
  async function refresh() {
    setWorking(true);
    onBusyChange?.(true);
    try {
      const latest = await api(`transactions/${transaction.id}?scope=${scope}`);
      if (mounted.current) {
        onSaved(latest);
        setSelection(
          latest.income_entry_id ? String(latest.income_entry_id) : "",
        );
        setReplace(false);
      }
      const refreshed = await onChanged();
      if (refreshed !== false && mounted.current) {
        setRefreshRequired(false);
        onRefreshRequiredChange?.(false);
        setError("");
      }
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) {
        setWorking(false);
        onBusyChange?.(false);
      }
    }
  }
  if (!eligible && !linked && !refreshRequired)
    return (
      <p className="income-assignment-note">
        Income matching is available for money received in USD. Save an ordinary
        income transaction to match a payday.
      </p>
    );
  return (
    <section
      className="income-assignment"
      aria-labelledby="income-assignment-title"
    >
      <h3 id="income-assignment-title">Match income</h3>
      {(linked || eligible) && (
        <p className="income-receipt-summary">
          <strong>{transaction.income_name || "Saved receipt"}</strong>
          <span>
            {receiptLabel}{" "}
            {money(transaction.amount_cents, transaction.currency || "USD")}
            {" · "}
            {prettyDate(transaction.date)}
            {transaction.income_month
              ? ` · ${monthLabel(transaction.income_month)}`
              : ""}
          </span>
        </p>
      )}
      {transaction.income_link_invalid && (
        <p className="inline-error" role="alert">
          This receipt changed and no longer counts as received income.{" "}
          {transaction.amount_cents < 0 &&
          ordinary &&
          !transaction.account_unavailable &&
          (transaction.currency || "USD") === "USD"
            ? "Its money out is still included in budget spending. "
            : ""}
          Unlink it, then correct its amount, currency or treatment.
        </p>
      )}
      <form onSubmit={save}>
        {draftChanged && (
          <p className="income-assignment-note">
            Save transaction changes above before matching income. You can still
            unlink its saved receipt.
          </p>
        )}
        {eligible && (
          <Field label="Income month">
            <input
              type="month"
              required
              value={targetMonth}
              onChange={(e) => {
                if (e.target.value) {
                  setTargetMonth(e.target.value);
                  setSelection("");
                  setReplace(false);
                }
              }}
              disabled={locked}
            />
          </Field>
        )}
        <Field
          label="Planned income"
          help="A receipt changes actual income. Scheduled dates and expected amounts stay as planned."
        >
          <select
            value={selection}
            onChange={(e) => {
              setSelection(e.target.value);
              setReplace(false);
            }}
            required
            disabled={locked || loading}
          >
            <option value="">
              {loading ? "Loading income…" : "Choose an income or payday"}
            </option>
            {linked &&
              eligible &&
              !available.some(
                (entry) => entry.id === transaction.income_entry_id,
              ) && (
                <option value={transaction.income_entry_id}>
                  {transaction.income_name || "Currently linked income"} ·
                  current link
                </option>
              )}
            {eligible &&
              available.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                  {entry.date ? ` · ${prettyDate(entry.date)}` : ""} ·{" "}
                  {money(entry.amount_cents)} expected
                  {entry.actual_received_cents
                    ? ` · ${money(entry.actual_received_cents)} received`
                    : ""}
                </option>
              ))}
            {eligible && <option value="new">Create a new income item</option>}
            {linked && <option value="unlink">Unlink this receipt</option>}
          </select>
        </Field>
        {selection === "new" && (
          <>
            <Field label="Income name">
              <input
                name="income_name"
                required
                maxLength={120}
                defaultValue={transaction.description}
                disabled={locked}
              />
            </Field>
            <div className="form-grid">
              <Field label="Expected amount">
                <div className="money-input">
                  <span>$</span>
                  <input
                    name="expected_amount"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={(transaction.amount_cents / 100).toFixed(2)}
                    disabled={locked}
                  />
                </div>
              </Field>
              <Field label="Expected date">
                <input
                  key={targetMonth}
                  name="income_date"
                  type="date"
                  required
                  min={`${targetMonth}-01`}
                  max={lastDate}
                  defaultValue={
                    transaction.date.slice(0, 7) === targetMonth
                      ? transaction.date.slice(0, 10)
                      : `${targetMonth}-01`
                  }
                  disabled={locked}
                />
              </Field>
            </div>
            <p className="muted small">
              Creates one income item and links this receipt together. Choose an
              existing payday when it is already in your plan.
            </p>
          </>
        )}
        {replacing && (
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
              disabled={locked}
            />
            <span>
              Replace this transaction’s{" "}
              {transaction.category_id
                ? "budget item assignment"
                : "current income assignment"}
              .
            </span>
          </label>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {lookupFailed && (
          <Button
            type="button"
            variant="ghost"
            icon={RefreshCw}
            onClick={() => setLookupRevision((revision) => revision + 1)}
            disabled={locked}
          >
            Retry income list
          </Button>
        )}
        {refreshRequired ? (
          <Button
            type="button"
            variant="secondary"
            icon={RefreshCw}
            busy={working}
            onClick={refresh}
          >
            Refresh income
          </Button>
        ) : (
          <Button
            type="submit"
            variant="secondary"
            icon={Link2}
            busy={working}
            disabled={
              busy ||
              loading ||
              !selection ||
              ((lookupFailed || draftChanged) && selection !== "unlink") ||
              (replacing && !replace)
            }
          >
            {selection === "unlink"
              ? "Unlink receipt"
              : linked
                ? "Save income match"
                : "Match receipt"}
          </Button>
        )}
      </form>
    </section>
  );
}
