import {
  CalendarDays,
  CircleDollarSign,
  Plus,
  Pencil,
  Trash2,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { Button, IconButton, Empty } from "./ui.jsx";
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
    <section className="card income-card">
      <div className="card-heading income-heading">
        <div>
          <p className="eyebrow">THE STARTING POINT</p>
          <h2>What comes in</h2>
          <p className="card-description">
            A name for each income. A place for every payday.
          </p>
        </div>
        <Button icon={Plus} onClick={onAdd}>
          Add income
        </Button>
      </div>
      <div className="income-card-summary">
        <span>Expected in {monthLabel(month).split(" ")[0]}</span>
        <strong>{money(income?.total_cents || 0)}</strong>
        <span className="income-summary-note">
          {entries.length} income entr{entries.length === 1 ? "y" : "ies"}
        </span>
      </div>
      <div className="income-sources">
        {scheduled.map((source) => (
          <article className="income-source" key={source.id}>
            <div className="income-source-heading">
              <span className="income-symbol">
                <CalendarDays size={19} />
              </span>
              <div className="income-source-name">
                <h3>{source.name}</h3>
                <p>
                  {cadenceLabels[source.cadence] || "Scheduled"} ·{" "}
                  {money(source.amount_cents)} per payment
                </p>
                {source.stopped_from ? (
                  <span className="income-schedule-status">
                    {source.stopped_from <= `${month}-01` ? "Stopped" : "Stops"}{" "}
                    from {monthLabel(source.stopped_from.slice(0, 7))}
                  </span>
                ) : source.active === false && source.effective_from ? (
                  <span className="income-schedule-status">
                    Starts {monthLabel(source.effective_from.slice(0, 7))}
                  </span>
                ) : null}
              </div>
              <div className="income-source-total">
                <strong>
                  {money(
                    source.entries.reduce(
                      (sum, entry) => sum + entry.amount_cents,
                      0,
                    ),
                  )}
                </strong>
                <small>this month</small>
              </div>
              <div className="income-source-actions">
                <IconButton
                  label={`Edit ${source.name} schedule`}
                  onClick={() => onEditSource(source)}
                  disabled={busy}
                >
                  <Pencil size={15} />
                </IconButton>
                {(!source.stopped_from ||
                  source.stopped_from > `${month}-01`) && (
                  <IconButton
                    label={`Stop ${source.name} schedule`}
                    onClick={() => onStopSource(source)}
                    disabled={busy}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                )}
              </div>
            </div>
            <div
              className="income-paydays"
              aria-label={`${source.name} paydays`}
            >
              {source.entries.map((entry) => (
                <div
                  className={`income-payday ${entry.overridden ? "adjusted" : ""}`}
                  key={entry.id}
                >
                  <button
                    className="income-payday-main"
                    onClick={() => onEditEntry(entry)}
                    disabled={busy}
                    aria-label={`Edit ${entry.name} payment on ${prettyDate(entry.date)}`}
                  >
                    <span>{prettyDate(entry.date)}</span>
                    <strong>{money(entry.amount_cents)}</strong>
                    {entry.overridden && (
                      <small>
                        {entry.name !== source.name ? entry.name : "Adjusted"}
                      </small>
                    )}
                  </button>
                  <div className="income-payday-actions">
                    {entry.overridden && onResetEntry && (
                      <IconButton
                        label={`Restore ${source.name} scheduled payment on ${prettyDate(entry.date)}`}
                        onClick={() => onResetEntry(entry)}
                        disabled={busy}
                      >
                        <RefreshCw size={12} />
                      </IconButton>
                    )}
                    <IconButton
                      label={`Remove ${source.name} payment on ${prettyDate(entry.date)}`}
                      onClick={() => onRemoveEntry(entry)}
                      disabled={busy}
                    >
                      <Trash2 size={12} />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
            <p className="income-payday-hint">
              {source.entries.length
                ? "Select a payday to adjust that payment. Edit the schedule to change future paydays."
                : source.stopped_from && source.stopped_from <= `${month}-01`
                  ? "This schedule has stopped. Edit it to start filling expected paydays again."
                  : "No payments fall in this month. This schedule can still fill future plans."}
            </p>
            {source.skipped_count > 0 && (
              <div className="income-skipped-note">
                <div>
                  <strong>
                    {source.skipped_count} skipped payday
                    {source.skipped_count === 1 ? "" : "s"}
                  </strong>
                  <p>
                    From {monthLabel(month)} onward. These payments stay outside
                    your plan until you restore them.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  icon={RefreshCw}
                  onClick={() => onRestoreSkipped(source)}
                  disabled={busy}
                >
                  Restore skipped paydays
                </Button>
              </div>
            )}
          </article>
        ))}
        {manual.map((entry) => (
          <article className="income-manual-row" key={entry.id}>
            <span className="income-symbol">
              <CircleDollarSign size={19} />
            </span>
            <div className="income-source-name">
              <h3>{entry.name}</h3>
              <p>
                {entry.kind === "legacy"
                  ? "Previous monthly total"
                  : entry.date
                    ? `One-time income · ${prettyDate(entry.date)}`
                    : "Monthly income"}
              </p>
            </div>
            <strong className="income-manual-amount">
              {money(entry.amount_cents)}
            </strong>
            <div className="income-source-actions">
              <IconButton
                label={`Edit ${entry.name} income`}
                onClick={() => onEditEntry(entry)}
                disabled={busy}
              >
                <Pencil size={15} />
              </IconButton>
              <IconButton
                label={`Remove ${entry.name} income`}
                onClick={() => onRemoveEntry(entry)}
                disabled={busy}
              >
                <Trash2 size={15} />
              </IconButton>
            </div>
          </article>
        ))}
      </div>
      {!entries.length && !sources.length && (
        <Empty
          icon={CircleDollarSign}
          title="Start with what comes in."
          description="Name a paycheck, a side project, or any other income. Add it for this month, or let a pay schedule fill in the dates."
          action={
            <Button variant="secondary" icon={Plus} onClick={onAdd}>
              Add your first income
            </Button>
          }
        />
      )}
      {shared?.contributors > 0 && (
        <div className="income-shared-row">
          <span className="income-symbol private">
            <LockKeyhole size={17} />
          </span>
          <div>
            <strong>Shared personal income</strong>
            <p>
              {shared.contributors} member{shared.contributors === 1 ? "" : "s"}{" "}
              · Individual sources and paydays stay private
            </p>
          </div>
          <strong>{money(shared.income_cents)}</strong>
        </div>
      )}
    </section>
  );
}
