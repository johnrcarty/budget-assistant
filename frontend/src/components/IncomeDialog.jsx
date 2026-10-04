import { useState } from "react";
import {
  CalendarDays,
  Check,
  Trash2,
  AlertCircle,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { Button, Field, Modal } from "./ui.jsx";
import {
  money,
  today,
  thisMonth,
  monthLabel,
  stepMonth,
} from "../lib/format.js";

const cadenceOptions = [
  ["manual", "No schedule · monthly income"],
  ["once", "One scheduled payment"],
  ["weekly", "Every week"],
  ["biweekly", "Every two weeks"],
  ["semimonthly", "Twice a month"],
  ["monthly", "Every month"],
];
const dateForMonth = (month, timezone) =>
  thisMonth(timezone) === month ? today(timezone) : `${month}-01`;
function DaySelect({ name, value, label }) {
  return (
    <Field label={label}>
      <select name={name} defaultValue={value}>
        {Array.from({ length: 31 }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            {i + 1}
          </option>
        ))}
        <option value="last">Last day of the month</option>
      </select>
    </Field>
  );
}

export default function IncomeDialog({
  modal,
  month,
  scope,
  user,
  income,
  busy,
  error,
  onSave,
  onDelete,
  onRestore,
  onClose,
}) {
  const item = modal.item;
  const isEntry = modal.type === "income-entry";
  const isSource = modal.type === "income-source";
  const isDelete = modal.type === "income-delete";
  const isRestore = modal.type === "income-restore";
  const lastDay = new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)),
    0,
  ).getDate();
  const currentMonth = thisMonth(user.timezone),
    nextMonth = stepMonth(currentMonth, 1);
  const defaultEffective = month > nextMonth ? month : nextMonth;
  const [cadence, setCadence] = useState(
    isSource ? item?.cadence || "monthly" : "manual",
  );
  const isScheduled = cadence !== "manual";
  const legacyTotal = (income?.entries || [])
    .filter((entry) => entry.kind === "legacy")
    .reduce((sum, entry) => sum + entry.amount_cents, 0);
  const title = isRestore
    ? "Restore skipped paydays?"
    : isDelete
      ? item?.kind === "source"
        ? "Stop this pay schedule?"
        : "Remove this income?"
      : isEntry
        ? item?.source_id
          ? "Adjust this payment"
          : "Edit named income"
        : isSource
          ? "Adjust your pay schedule"
          : "Give your income a name";
  const description = isRestore
    ? `Restore ${item?.skipped_count || 0} skipped payday${item?.skipped_count === 1 ? "" : "s"} for “${item?.name}” from ${monthLabel(month)} onward.`
    : isDelete
      ? item?.kind === "source"
        ? `Choose when “${item.name}” stops adding expected paydays. Earlier income plans stay in place.`
        : `“${item?.name}” will be removed from this month’s expected income. Other paydays and the schedule stay in place.`
      : isEntry
        ? item?.source_id
          ? "Change this expected payment. The other paydays stay as planned."
          : "Change this named income in the monthly plan."
        : isSource
          ? "Keep a good rhythm, with room for life to change."
          : "Add a named monthly amount, or let a schedule fill in your paydays.";
  return (
    <Modal
      title={title}
      description={description}
      onClose={() => !busy && onClose()}
    >
      <form onSubmit={isRestore ? onRestore : isDelete ? onDelete : onSave}>
        {isRestore ? (
          <>
            <p className="muted small">
              This clears skipped-payday exclusions from the selected month and
              future months. Expected income follows this schedule again.
              Payments you adjusted keep their values.
            </p>
            {item?.stopped_from && (
              <p className="income-form-note">
                <RefreshCw size={15} />
                This schedule has a stop date. Clearing skips restores paydays
                only within its active months. Edit the schedule to resume it
                later.
              </p>
            )}
          </>
        ) : isDelete ? (
          <>
            {item?.kind === "source" && (
              <Field
                label="Stop from"
                help="The schedule stops adding expected payments from this month. Earlier months are preserved."
              >
                <input
                  type="month"
                  name="effective_month"
                  min={currentMonth}
                  required
                  defaultValue={defaultEffective}
                />
              </Field>
            )}
            <p className="muted small">
              {item?.kind === "source"
                ? "Scheduled amounts from that month onward stop filling your plan. Adjusted payments and earlier months stay in place."
                : item?.source_id
                  ? "Removing this payment skips that payday only. Your bank transactions are unchanged."
                  : "This named amount will leave your monthly income plan. Your bank transactions are unchanged."}
            </p>
          </>
        ) : (
          <>
            <Field label="Income name">
              <input
                name="name"
                required
                maxLength={120}
                autoFocus
                defaultValue={item?.name || ""}
                placeholder="Paycheck, side project, rental income…"
              />
            </Field>
            <Field
              label={
                isEntry
                  ? "Expected amount"
                  : isScheduled
                    ? "Amount per payment"
                    : "Expected amount"
              }
              help={
                isEntry && item?.source_id
                  ? "An adjustment affects this payment only. Use zero to skip its expected amount."
                  : undefined
              }
            >
              <div className="money-input">
                <span>$</span>
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  defaultValue={
                    item?.amount_cents !== undefined
                      ? (item.amount_cents / 100).toFixed(2)
                      : ""
                  }
                  placeholder="0.00"
                />
              </div>
            </Field>
            {!isEntry && (
              <Field label="Repeat this income">
                <select
                  name="cadence"
                  value={cadence}
                  onChange={(event) => setCadence(event.target.value)}
                >
                  {cadenceOptions
                    .filter(([value]) => !isSource || value !== "manual")
                    .map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {isEntry && (
              <Field
                label={
                  item?.source_id ? "Expected date" : "Expected date (optional)"
                }
                help={
                  !item?.source_id
                    ? "Leave blank for an undated monthly amount. Dated one-time income is not copied to another month."
                    : undefined
                }
              >
                <input
                  name="date"
                  type="date"
                  required={Boolean(item?.source_id)}
                  defaultValue={item.date || ""}
                />
              </Field>
            )}
            {!isEntry && cadence === "manual" && (
              <Field
                label="Expected date (optional)"
                help="Leave blank for an undated monthly amount. Dated one-time income is not copied to another month."
              >
                <input
                  name="date"
                  type="date"
                  min={`${month}-01`}
                  max={`${month}-${lastDay}`}
                  defaultValue=""
                />
              </Field>
            )}
            {!isEntry &&
              ["once", "weekly", "biweekly", "monthly"].includes(cadence) && (
                <Field
                  label={
                    cadence === "once"
                      ? "Pay date"
                      : cadence === "monthly"
                        ? "A payday to start from"
                        : "First payday"
                  }
                  help={
                    cadence === "biweekly"
                      ? "Every 14 days from this payday. Some months naturally have three payments."
                      : cadence === "weekly"
                        ? "Every 7 days from this payday. The calendar decides how many fall in each month."
                        : cadence === "monthly"
                          ? "Uses this day of the month. In shorter months, the payday falls on the last day."
                          : undefined
                  }
                >
                  <input
                    name="anchor_date"
                    type="date"
                    required
                    defaultValue={
                      item?.anchor_date || dateForMonth(month, user.timezone)
                    }
                  />
                </Field>
              )}
            {!isEntry && cadence === "semimonthly" && (
              <>
                <div className="form-grid">
                  <DaySelect
                    name="day1"
                    label="First payday"
                    value={item?.day1 || 15}
                  />
                  <DaySelect
                    name="day2"
                    label="Second payday"
                    value={item?.day2 || "last"}
                  />
                </div>
                <p className="income-form-note">
                  <CalendarDays size={15} />
                  Days beyond a shorter month fall on its last day. Two expected
                  payments stay separate, even when their dates coincide.
                </p>
                <input
                  type="hidden"
                  name="anchor_date"
                  value={item?.anchor_date || `${month}-01`}
                />
              </>
            )}
            {isSource && (
              <Field
                label="Apply changes from"
                help="The selected month and future expected paydays use this schedule. Earlier plans stay in place."
              >
                <input
                  type="month"
                  required
                  name="effective_month"
                  min={currentMonth}
                  defaultValue={defaultEffective}
                />
              </Field>
            )}
            {isSource && item?.stopped_from && (
              <p className="income-form-note">
                <RefreshCw size={15} />
                This schedule has a stop date. Saving it resumes expected
                paydays from the selected month.
              </p>
            )}
            {!isSource && !isEntry && isScheduled && (
              <div className="income-form-note">
                <RefreshCw size={15} />
                <span>
                  This schedule starts in {monthLabel(month)}. Its paydays are
                  added to your plan automatically.
                </span>
              </div>
            )}
            {!isSource && !isEntry && legacyTotal > 0 && (
              <label className="income-replace-option">
                <input name="replace_legacy" type="checkbox" />
                <span>
                  <strong>
                    Replace previous monthly total ({money(legacyTotal)})
                  </strong>
                  <small>
                    Remove the old combined income row when saving this named
                    income. Leave unchecked to keep both.
                  </small>
                </span>
              </label>
            )}
            <div className="income-form-note privacy">
              <LockKeyhole size={14} />
              {scope === "personal"
                ? "Your income names and paydays are visible only to you."
                : "This income is part of the shared household budget."}
            </div>
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            <AlertCircle size={16} />
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button
            variant="secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            {isDelete ? "Keep it" : "Cancel"}
          </Button>
          <Button
            type="submit"
            busy={busy}
            variant={isDelete ? "danger" : ""}
            icon={isRestore ? RefreshCw : isDelete ? Trash2 : Check}
          >
            {isRestore
              ? "Restore skipped paydays"
              : isDelete
                ? item?.kind === "source"
                  ? "Stop schedule"
                  : "Remove payment"
                : isEntry
                  ? "Save payment"
                  : isSource
                    ? "Save schedule"
                    : isScheduled
                      ? "Add pay schedule"
                      : "Add income"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
