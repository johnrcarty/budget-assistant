import {
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Plus,
  Pencil,
  Trash2,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { Button, IconButton } from "./ui.jsx";
import { money, prettyDate, monthLabel } from "../lib/format.js";

export const cadenceLabels = {
  manual: "Manual income",
  once: "One scheduled payment",
  weekly: "Weekly",
  biweekly: "Every two weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
};

export default function IncomeSection({
  income,
  month,
  shared,
  busy,
  onAdd,
  onEditEntry,
  onRemoveEntry,
  onEditSource,
  onStopSource,
  onResetEntry,
  onRestoreSkipped,
}) {
  const entries = income?.entries || [];
  const sources = income?.sources || [];
  const scheduled = sources.map((source) => ({
    ...source,
    entries: entries.filter((entry) => entry.source_id === source.id),
  }));
  const manual = entries.filter((entry) => !entry.source_id);
  return (
    <section className="card income-card" aria-labelledby="income-title">
      <div className="card-heading income-heading">
        <h2 id="income-title">Income</h2>
        <Button icon={Plus} onClick={onAdd}>
          Add income
        </Button>
      </div>
      <div className="income-card-summary">
        <span>Expected in {monthLabel(month).split(" ")[0]}</span>
        <strong>{money(income?.total_cents || 0)}</strong>
      </div>
      <div className="income-sources">
        {scheduled.map((source) => (
          <details className="income-source" key={`${month}:${source.id}`}>
            <summary className="income-source-summary">
              <span className="income-symbol" aria-hidden="true">
                <CalendarDays size={18} />
              </span>
              <span className="income-source-name">
                <strong>{source.name}</strong>
                <span className="income-source-meta">
                  {source.cadence === "once"
                    ? "One-time"
                    : cadenceLabels[source.cadence] || "Scheduled"}
                  {" · "}
                  {source.entries.length} payday
                  {source.entries.length === 1 ? "" : "s"}
                </span>
                {(source.stopped_from ||
                  (source.active === false && source.effective_from) ||
                  source.skipped_count > 0) && (
                  <span className="income-source-statuses">
                    {source.stopped_from ? (
                      <span className="income-schedule-status">
                        {source.stopped_from <= `${month}-01`
                          ? "Stopped"
                          : "Stops"}{" "}
                        from {monthLabel(source.stopped_from.slice(0, 7))}
                      </span>
                    ) : source.active === false && source.effective_from ? (
                      <span className="income-schedule-status">
                        Starts {monthLabel(source.effective_from.slice(0, 7))}
                      </span>
                    ) : null}
                    {source.skipped_count > 0 && (
                      <span
                        className="income-schedule-status"
                        title={`Skipped paydays from ${monthLabel(month)} onward`}
                      >
                        {source.skipped_count} skipped
                      </span>
                    )}
                  </span>
                )}
              </span>
              <span className="income-source-total">
                <strong>
                  {money(
                    source.entries.reduce(
                      (sum, entry) => sum + entry.amount_cents,
                      0,
                    ),
                  )}
                </strong>
                <small>this month</small>
              </span>
              <ChevronDown
                className="income-source-chevron"
                size={17}
                aria-hidden="true"
              />
            </summary>
            <div className="income-source-body">
              <div className="income-schedule-toolbar">
                <span>{money(source.amount_cents)} per payment</span>
                <div className="income-source-actions">
                  <Button
                    variant="ghost"
                    icon={Pencil}
                    aria-label={`Edit ${source.name} schedule`}
                    onClick={() => onEditSource(source)}
                    disabled={busy}
                  >
                    Edit schedule
                  </Button>
                  {(!source.stopped_from ||
                    source.stopped_from > `${month}-01`) && (
                    <IconButton
                      label={`Stop ${source.name} schedule`}
                      onClick={() => onStopSource(source)}
                      disabled={busy}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  )}
                </div>
              </div>
              <div
                className="income-paydays"
                aria-label={`${source.name} paydays`}
              >
                {source.entries.map((entry) => {
                  const dateLabel = entry.date
                    ? prettyDate(entry.date)
                    : "Monthly amount";
                  return (
                    <div
                      className={`income-payday ${entry.overridden ? "adjusted" : ""}`}
                      key={entry.id}
                    >
                      <button
                        type="button"
                        className="income-payday-main"
                        onClick={() => onEditEntry(entry)}
                        disabled={busy}
                        aria-label={`Edit ${entry.name} payment, ${dateLabel}, ${money(entry.amount_cents)}`}
                      >
                        <span>{dateLabel}</span>
                        <strong>{money(entry.amount_cents)}</strong>
                        {entry.overridden && (
                          <small>
                            Adjusted
                            {entry.name !== source.name
                              ? ` · ${entry.name}`
                              : ""}
                          </small>
                        )}
                      </button>
                      <div className="income-payday-actions">
                        {entry.overridden && onResetEntry && (
                          <IconButton
                            label={`Restore ${source.name} scheduled payment, ${dateLabel}`}
                            onClick={() => onResetEntry(entry)}
                            disabled={busy}
                          >
                            <RefreshCw size={15} />
                          </IconButton>
                        )}
                        <IconButton
                          label={`Skip ${source.name} payment, ${dateLabel}`}
                          onClick={() => onRemoveEntry(entry)}
                          disabled={busy}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                    </div>
                  );
                })}
              </div>
              {!source.entries.length && (
                <p className="income-no-paydays">
                  No paydays in {monthLabel(month)}.
                </p>
              )}
              {source.skipped_count > 0 && (
                <div className="income-skipped-note">
                  <span>
                    {source.skipped_count} skipped payday
                    {source.skipped_count === 1 ? "" : "s"} from{" "}
                    {monthLabel(month)} onward
                  </span>
                  <Button
                    variant="secondary"
                    icon={RefreshCw}
                    onClick={() => onRestoreSkipped(source)}
                    disabled={busy}
                  >
                    Restore skipped
                  </Button>
                </div>
              )}
            </div>
          </details>
        ))}
        {manual.map((entry) => (
          <article className="income-manual-row" key={entry.id}>
            <button
              type="button"
              className="income-manual-main"
              aria-label={`Edit ${entry.name} income, ${money(entry.amount_cents)}${entry.date ? `, ${prettyDate(entry.date)}` : ", monthly income"}`}
              title={`Edit ${entry.name} income`}
              onClick={() => onEditEntry(entry)}
              disabled={busy}
            >
              <span className="income-symbol" aria-hidden="true">
                <CircleDollarSign size={18} />
              </span>
              <span className="income-source-name">
                <strong>{entry.name}</strong>
                <span className="income-source-meta">
                  {entry.kind === "legacy"
                    ? "Previous monthly total"
                    : entry.date
                      ? `One-time · ${prettyDate(entry.date)}`
                      : "Monthly income"}
                </span>
              </span>
              <strong className="income-manual-amount">
                {money(entry.amount_cents)}
              </strong>
              <Pencil
                size={14}
                className="income-manual-edit"
                aria-hidden="true"
              />
            </button>
            <IconButton
              label={`Remove ${entry.name} income`}
              onClick={() => onRemoveEntry(entry)}
              disabled={busy}
            >
              <Trash2 size={16} />
            </IconButton>
          </article>
        ))}
      </div>
      {!entries.length && !sources.length && (
        <p className="income-empty">
          Add an income or pay schedule to start this month’s plan.
        </p>
      )}
      {shared?.contributors > 0 && (
        <div className="income-shared-row">
          <span className="income-symbol private" aria-hidden="true">
            <LockKeyhole size={17} />
          </span>
          <div>
            <strong>Shared personal income</strong>
            <p>
              {shared.contributors} member{shared.contributors === 1 ? "" : "s"}{" "}
              · Sources and paydays stay private
            </p>
          </div>
          <strong>{money(shared.income_cents)}</strong>
        </div>
      )}
    </section>
  );
}
