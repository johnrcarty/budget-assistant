import { useEffect, useRef, useState } from "react";
import {
  X,
  Pencil,
  CalendarDays,
  Check,
  AlertCircle,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { api } from "../lib/api.js";
import {
  cents,
  money,
  monthLabel,
  today,
  thisMonth,
  stepMonth,
  prettyDate,
} from "../lib/format.js";
import {
  accountKinds,
  isDebt,
  isPaidOffLoan,
  debtLabels,
  scheduleLabel,
} from "../lib/accounts.js";
import { Button, Field, IconButton } from "./ui.jsx";
import AccountHistoryChart from "./AccountHistoryChart.jsx";
import AccountCollateral from "./AccountCollateral.jsx";
import AccountValuation from "./AccountValuation.jsx";

function ScheduleForm({ account, month, user, busy, onSubmit, onCancel }) {
  const schedule =
    account.upcoming_payment_schedule || account.payment_schedule;
  const current = thisMonth(user.timezone);
  const [cadence, setCadence] = useState(schedule?.cadence || "monthly");
  const [active, setActive] = useState(schedule?.active ?? true);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form onSubmit={onSubmit} className="account-schedule-form">
      <fieldset disabled={busy}>
        <div className="form-grid">
          <Field label="Payment amount">
            <div className="money-input">
              <span>$</span>
              <input
                name="amount"
                type="number"
                min="0"
                step="0.01"
                required
                defaultValue={
                  schedule?.amount_cents != null
                    ? (schedule.amount_cents / 100).toFixed(2)
                    : ""
                }
                placeholder="0.00"
              />
            </div>
          </Field>
          <Field label="Frequency">
            <select
              name="cadence"
              value={cadence}
              onChange={(event) => setCadence(event.target.value)}
            >
              <option value="monthly">Monthly</option>
              <option value="semimonthly">Twice monthly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="weekly">Weekly</option>
            </select>
          </Field>
        </div>
        <Field
          label={
            cadence === "weekly" || cadence === "biweekly"
              ? "Starting payment date"
              : "Schedule start date"
          }
          help={
            cadence === "biweekly"
              ? "Payments follow every 14 days from this date."
              : cadence === "weekly"
                ? "Payments follow every 7 days from this date."
                : "Calendar days clamp to the last day in shorter months."
          }
        >
          <input
            name="anchor_date"
            type="date"
            required
            defaultValue={schedule?.anchor_date || today(user.timezone)}
          />
        </Field>
        {(cadence === "monthly" || cadence === "semimonthly") && (
          <div className={cadence === "semimonthly" ? "form-grid" : ""}>
            <Field
              label={
                cadence === "semimonthly" ? "First payment day" : "Payment day"
              }
            >
              <select
                name="day1"
                defaultValue={
                  schedule?.day1 ||
                  Number(schedule?.anchor_date?.slice(-2)) ||
                  15
                }
              >
                {Array.from({ length: 31 }, (_, index) => (
                  <option key={index + 1} value={index + 1}>
                    {index + 1}
                  </option>
                ))}
                <option value="last">Last day</option>
              </select>
            </Field>
            {cadence === "semimonthly" && (
              <Field label="Second payment day">
                <select name="day2" defaultValue={schedule?.day2 || "last"}>
                  {Array.from({ length: 31 }, (_, index) => (
                    <option key={index + 1} value={index + 1}>
                      {index + 1}
                    </option>
                  ))}
                  <option value="last">Last day</option>
                </select>
              </Field>
            )}
          </div>
        )}
        <Field
          label="Apply from month"
          help="Paid history and earlier unpaid reminders are kept."
        >
          <input
            name="effective_month"
            required
            type="month"
            min={current}
            defaultValue={
              account.upcoming_payment_schedule
                ? account.upcoming_payment_schedule.effective_from.slice(0, 7)
                : schedule
                  ? stepMonth(current, 1)
                  : month >= current
                    ? month
                    : current
            }
          />
        </Field>
        <label className="checkbox-field">
          <input
            name="active"
            type="checkbox"
            checked={active}
            onChange={(event) => {
              setActive(event.target.checked);
              setConfirmed(false);
            }}
          />
          <span>Include scheduled payments in the budget</span>
        </label>
        {!active && schedule?.active && (
          <label className="checkbox-field schedule-stop-confirm">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              Stop future unpaid reminders from the selected month. Existing
              paid history and earlier debt stay.
            </span>
          </label>
        )}
        {active && (
          <p className="account-form-note">
            An existing manual bill or budget item for this debt stays separate.
            Remove any duplicate yourself so it is not planned twice.
          </p>
        )}
      </fieldset>
      <div className="drawer-form-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button type="submit" icon={Check} busy={busy}>
          Save schedule
        </Button>
      </div>
    </form>
  );
}

export default function AccountDetails({
  account,
  scope,
  month,
  user,
  accounts = [],
  studentLoanGroups = [],
  bills = [],
  onClose,
  onEdit,
  onOpenAccount,
  onOpenLoanGroup,
  onChanged,
  notify,
}) {
  const dialog = useRef(null);
  const mounted = useRef(false);
  const restoreRefreshFocus = useRef(false);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [collateralError, setCollateralError] = useState("");
  const [collateralRefreshFailed, setCollateralRefreshFailed] = useState(false);
  const [accountsRefreshFailed, setAccountsRefreshFailed] = useState(false);
  const [collateralOverride, setCollateralOverride] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [historyCurrency, setHistoryCurrency] = useState(
    account.currency || "USD",
  );
  const debt = isDebt(account);
  const refreshLocked = accountsRefreshFailed || collateralRefreshFailed;
  const query = `scope=${scope}&month=${month}`;
  const schedule = account.payment_schedule;
  const upcoming = account.upcoming_payment_schedule;
  const payments = bills.filter(
    (bill) =>
      bill.debt_account_id === account.id && bill.due_date?.startsWith(month),
  );
  useEffect(() => {
    setCollateralOverride(null);
    setCollateralError("");
    setCollateralRefreshFailed(false);
    setAccountsRefreshFailed(false);
  }, [account]);
  useEffect(() => {
    if (busy || !dialog.current) return;
    if (refreshLocked) dialog.current.querySelector(".account-refresh-trigger:not(:disabled)")?.focus();
    else if (restoreRefreshFocus.current) {
      dialog.current.querySelector('button[aria-label="Close account details"]')?.focus();
      restoreRefreshFocus.current = false;
    }
  }, [busy, refreshLocked]);
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    dialog.current.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.current?.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    mounted.current = true;
    setLoading(true);
    setError("");
    setHistory(null);
    api(`accounts/${account.id}/history?${query}`, { signal: abort.signal })
      .then((result) => {
        if (mounted.current && !abort.signal.aborted) setHistory(result);
      })
      .catch((failure) => {
        if (mounted.current && !abort.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (mounted.current && !abort.signal.aborted) setLoading(false);
      });
    return () => {
      mounted.current = false;
      abort.abort();
    };
  }, [account.id, query, revision]);
  async function refreshAccounts() {
    try {
      const refreshed = await onChanged();
      if (mounted.current) {
        setAccountsRefreshFailed(refreshed === false);
        if (refreshed !== false) setCollateralRefreshFailed(false);
      }
      return refreshed !== false;
    } catch {
      if (mounted.current) setAccountsRefreshFailed(true);
      return false;
    }
  }
  async function retryAccounts() {
    setBusy(true);
    try {restoreRefreshFocus.current = await refreshAccounts();}
    finally {if (mounted.current) setBusy(false);}
  }
  async function saveSchedule(event) {
    event.preventDefault();
    if (busy || refreshLocked) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const day = (value, fallback) => {
      const resolved = value || fallback;
      return resolved === "last" ? "last" : Number(resolved);
    };
    setBusy(true);
    setScheduleError("");
    try {
      await api(`accounts/${account.id}/payment-schedule?${query}`, {
        method: "PUT",
        body: {
          amount_cents: cents(values.amount),
          cadence: values.cadence,
          anchor_date: values.anchor_date,
          day1: day(values.day1, Number(values.anchor_date.slice(-2))),
          day2: day(values.day2, "last"),
          active: values.active === "on",
          effective_from: `${values.effective_month}-01`,
        },
      });
      if (mounted.current) setEditing(false);
      notify(
        `Payment schedule saved from ${monthLabel(values.effective_month)}.`,
      );
      await refreshAccounts();
    } catch (failure) {
      if (mounted.current) setScheduleError(failure.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function saveCollateral(body) {
    if (busy || refreshLocked) return false;
    setBusy(true);
    setCollateralError("");
    try {
      const result = await api(`accounts/${account.id}/collateral?${query}`, {
        method: "PUT",
        body,
      });
      if (!mounted.current) return false;
      setCollateralOverride(result);
      notify(
        body.asset_id === null
          ? "Asset unlinked. It stays in Accounts."
          : "Asset linked.",
      );
      try {
        const refreshed = await refreshAccounts();
        if (refreshed === false && mounted.current) {
          setCollateralRefreshFailed(true);
          setCollateralError(
            "The link was saved, but account refresh failed. Refresh Accounts before making another change.",
          );
        }
      } catch {
        if (mounted.current) {
          setCollateralRefreshFailed(true);
          setCollateralError(
            "The link was saved, but account refresh failed. Refresh Accounts before making another change.",
          );
        }
      }
      return true;
    } catch (failure) {
      if (mounted.current) setCollateralError(failure.message);
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function refreshCollateral() {
    setBusy(true);
    try {
      const refreshed = await refreshAccounts();
      if (!mounted.current) return;
      setCollateralRefreshFailed(refreshed === false);
      setCollateralError(
        refreshed === false
          ? "Account refresh failed. The saved asset link is kept; try Refresh accounts again."
          : "",
      );
    } catch {
      if (mounted.current) {
        setCollateralRefreshFailed(true);
        setCollateralError(
          "Account refresh failed. The saved asset link is kept; try Refresh accounts again.",
        );
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function close() {
    if (!busy) onClose();
  }
  return (
    <dialog
      ref={dialog}
      className="item-drawer account-drawer"
      aria-labelledby="account-detail-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = dialog.current.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          close();
      }}
    >
      <div className="item-drawer-header">
        <div>
          <p className="eyebrow">{account.institution || "ACCOUNT DETAILS"}</p>
          <h2 id="account-detail-title">{account.name}</h2>
          <span className="item-drawer-category">
            {debtLabels[account.debt_type] ||
              accountKinds[account.kind] ||
              account.kind}{" "}
            · {account.currency || "USD"}
            {account.active === false ? " · Archived" : ""}
          </span>
        </div>
        <div className="item-drawer-header-actions">
          <IconButton
            label={`Edit ${account.name} account`}
            onClick={() => onEdit(account)}
            disabled={busy || refreshLocked || account.active === false}
          >
            <Pencil size={18} />
          </IconButton>
          <IconButton
            label="Close account details"
            onClick={close}
            disabled={busy}
          >
            <X size={21} />
          </IconButton>
        </div>
      </div>
      <div className="item-drawer-content">
        {refreshLocked && <div className="account-refresh-notice" role="alert"><p>The account change was saved. Refresh Accounts before making another change.</p><Button className="account-refresh-trigger" variant="secondary" icon={RefreshCw} busy={busy} onClick={retryAccounts}>Refresh accounts</Button></div>}
        <section className="account-detail-balance">
          <span>
            {debt
              ? "Current amount owed"
              : ["property", "vehicle"].includes(account.kind)
                ? "Current asset value"
                : "Current balance"}
          </span>
          <strong>
            {money(
              debt ? Math.abs(account.balance_cents) : account.balance_cents,
              account.currency || "USD",
            )}
          </strong>
          <p>
            {isPaidOffLoan(account) ? "Paid off · " : ""}
            {account.source === "simplefin"
              ? "Connected balance · refreshed on bank sync"
              : "Manual balance"}
          </p>
        </section>
        <AccountValuation account={account} group={studentLoanGroups.find((group) => group.id === account.student_loan_group_id)} scope={scope} month={month} busy={busy} locked={refreshLocked} onBusyChange={setBusy} onOpenGroup={onOpenLoanGroup} onChanged={refreshAccounts} notify={notify} />
        <AccountCollateral
          account={collateralOverride || account}
          accounts={accounts}
          busy={busy || refreshLocked}
          error={collateralError}
          refreshFailed={refreshLocked}
          showRefresh={false}
          onSave={saveCollateral}
          onRefresh={refreshCollateral}
          onEditAsset={onEdit}
          onOpenAccount={onOpenAccount}
        />
        {debt && (
          <section className="account-terms">
            <div className="drawer-section-heading">
              <h3>Debt terms</h3>
              <button
                type="button"
                className="text-button"
                onClick={() => onEdit(account)}
                disabled={busy || refreshLocked || account.active === false}
              >
                Edit terms <Pencil size={14} />
              </button>
            </div>
            <dl>
              <div>
                <dt>Original balance</dt>
                <dd>
                  {account.original_balance_cents == null
                    ? "Not entered"
                    : money(
                        account.original_balance_cents,
                        account.currency || "USD",
                      )}
                </dd>
              </div>
              <div>
                <dt>APR</dt>
                <dd>
                  {account.apr_basis_points == null
                    ? "Not entered"
                    : `${(account.apr_basis_points / 100).toFixed(2)}%`}
                </dd>
              </div>
              <div>
                <dt>Opened</dt>
                <dd>
                  {account.opened_date
                    ? prettyDate(account.opened_date) +
                      `, ${account.opened_date.slice(0, 4)}`
                    : "Not entered"}
                </dd>
              </div>
              {account.debt_type === "student" && <div className="account-interest-term"><dt>Reported accrued interest</dt><dd>{account.accrued_interest_cents == null ? "Not entered" : money(account.accrued_interest_cents, account.currency || "USD")}</dd>{account.accrued_interest_cents != null && <small>{account.accrued_interest_as_of ? `As of ${prettyDate(account.accrued_interest_as_of)}, ${account.accrued_interest_as_of.slice(0,4)}` : "Reporting date not entered"}{account.accrued_interest_stale ? " · Stale report, excluded from group subtotal" : ""}</small>}</div>}
              <div>
                <dt>Term</dt>
                <dd>
                  {account.term_months
                    ? `${account.term_months} months`
                    : "Not entered"}
                </dd>
              </div>
            </dl>
            {account.original_balance_cents > 0 && (
              <p className="account-principal-note">
                {money(
                  account.original_balance_cents -
                    Math.abs(account.balance_cents),
                  account.currency || "USD",
                )}{" "}
                change from original balance. Includes interest, new borrowing
                and balance changes.
              </p>
            )}
            {account.notes && <p className="account-notes">{account.notes}</p>}
          </section>
        )}
        {debt && (
          <section className="account-payment-plan">
            <div className="drawer-section-heading">
              <h3>Payment schedule</h3>
              {account.active !== false && !editing && (
                <Button
                  variant="ghost"
                  icon={CalendarDays}
                  onClick={() => {
                    setEditing(true);
                    setScheduleError("");
                  }}
                  disabled={busy || refreshLocked || account.currency !== "USD"}
                >
                  {upcoming
                    ? "Edit scheduled change"
                    : schedule
                      ? "Edit schedule"
                      : "Set schedule"}
                </Button>
              )}
            </div>
            <p className="drawer-muted">For {monthLabel(month)}</p>
            {account.currency !== "USD" && (
              <p className="drawer-muted">
                Budget payment schedules currently use USD. This account remains
                in its own currency.
              </p>
            )}
            {editing ? (
              <ScheduleForm
                key={`${account.id}-${schedule?.effective_from || "new"}`}
                account={account}
                month={month}
                user={user}
                busy={busy || refreshLocked}
                onSubmit={saveSchedule}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <>
                <p className="account-schedule-summary">
                  {schedule?.active && (
                    <strong>{money(schedule.amount_cents)} per payment</strong>
                  )}
                  <span>{scheduleLabel(schedule)}</span>
                  {schedule?.effective_from && (
                    <small>
                      Applies from{" "}
                      {monthLabel(schedule.effective_from.slice(0, 7))}
                    </small>
                  )}
                </p>
                {upcoming && (
                  <div className="upcoming-payment-plan">
                    <strong>
                      {upcoming.active
                        ? `Starts ${monthLabel(upcoming.effective_from.slice(0, 7))}`
                        : `Stops ${monthLabel(upcoming.effective_from.slice(0, 7))}`}
                    </strong>
                    {upcoming.active && (
                      <span>
                        {money(upcoming.amount_cents)} per payment ·{" "}
                        {scheduleLabel(upcoming)}
                      </span>
                    )}
                  </div>
                )}
                {payments.length > 0 && (
                  <div className="account-month-payments">
                    <h4>{monthLabel(month)} payments</h4>
                    {payments.map((payment) => (
                      <div key={payment.id}>
                        <time dateTime={payment.due_date}>
                          {prettyDate(payment.due_date)}
                        </time>
                        <strong>{money(payment.amount_cents)}</strong>
                        <span
                          className={`pill ${payment.paid ? "green" : "neutral"}`}
                        >
                          {payment.paid ? "Paid" : "Unpaid"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {scheduleError && (
              <p className="inline-error" role="alert">
                <AlertCircle size={16} />
                {scheduleError}
              </p>
            )}
          </section>
        )}
        <section className="account-detail-history">
          <label className="account-history-currency">
            <span>History currency</span>
            <select
              value={historyCurrency}
              onChange={(event) => setHistoryCurrency(event.target.value)}
            >
              {[
                ...new Set([
                  account.currency || "USD",
                  ...(history?.points || []).map(
                    (point) =>
                      point.currency ||
                      history?.currency ||
                      account.currency ||
                      "USD",
                  ),
                ]),
              ]
                .sort()
                .map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
            </select>
          </label>
          {loading ? (
            <div className="drawer-loading">
              <LoaderCircle className="spinning" size={24} />
              <p>Loading recorded balances…</p>
            </div>
          ) : error ? (
            <div className="drawer-load-error" role="alert">
              <p>{error}</p>
              <Button
                variant="secondary"
                onClick={() => setRevision((value) => value + 1)}
              >
                Retry history
              </Button>
            </div>
          ) : (
            <AccountHistoryChart
              points={(history?.points || []).filter(
                (point) =>
                  (point.currency ||
                    history?.currency ||
                    account.currency ||
                    "USD") === historyCurrency,
              )}
              currency={historyCurrency}
              valueKey="balance_cents"
              label="Balance history"
              id={`account-${account.id}`}
            />
          )}
        </section>
      </div>
    </dialog>
  );
}
