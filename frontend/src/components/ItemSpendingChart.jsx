import { money, monthLabel } from "../lib/format.js";

export default function ItemSpendingChart({ history = [], color = "#52705a" }) {
  const hasPlan = history.some((entry) => (entry.planned_cents || 0) > 0);
  const highest = Math.max(
    1,
    ...history.map((entry) =>
      Math.max(entry.spent_cents || 0, entry.planned_cents || 0),
    ),
  );
  const lowest = Math.min(0, ...history.map((entry) => entry.spent_cents || 0));
  const range = highest - lowest;
  const baseline = (highest / range) * 100;
  const hasRefunds = history.some((entry) => entry.spent_cents < 0);
  const hasPending = history.some((entry) => (entry.pending_cents || 0) !== 0);
  const hasActivity = history.some((entry) => (entry.spent_cents || 0) !== 0);
  const period = history.length
    ? `${monthLabel(history[0].month)} – ${monthLabel(history[history.length - 1].month)}`
    : "Last 12 months";
  return (
    <section className="item-history" aria-labelledby="item-history-title">
      <div className="drawer-section-heading">
        <h3 id="item-history-title">Spending over time</h3>
        <span>12 months</span>
      </div>
      <p className="drawer-muted">{period}</p>
      <p className="drawer-muted">
        History follows this item and its copied months.
      </p>
      <div className="item-chart-legend">
        <span>
          <i style={{ background: color }} />
          Net spent
        </span>
        {hasPlan && (
          <span>
            <i className="planned-mark" />
            Planned
          </span>
        )}
      </div>
      <div
        className="item-spending-chart"
        role="img"
        aria-label={`Monthly net spending, ${period}. Exact amounts are available below.${hasRefunds ? " Negative bars show net refunds." : ""}`}
      >
        <div className="item-chart-bars">
          <span
            className="item-chart-baseline"
            style={{ top: `${baseline}%` }}
          />
          {history.map((entry) => {
            const spent = entry.spent_cents || 0;
            return (
              <div
                className="item-chart-column"
                key={entry.month}
                title={`${monthLabel(entry.month)}: ${money(spent)} net spent`}
              >
                <span
                  className={`item-chart-bar ${spent < 0 ? "refund" : ""} ${spent === 0 ? "zero" : ""}`}
                  style={{
                    background: spent < 0 ? "#bf7154" : color,
                    top: `${spent >= 0 ? ((highest - spent) / range) * 100 : baseline}%`,
                    height: `${(Math.abs(spent) / range) * 100}%`,
                  }}
                />
                {hasPlan && entry.planned_cents > 0 && (
                  <span
                    className="item-chart-plan"
                    style={{
                      top: `${((highest - entry.planned_cents) / range) * 100}%`,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="item-chart-labels" aria-hidden="true">
          {history.map((entry) => (
            <span key={entry.month}>
              {new Date(`${entry.month}-15T12:00:00`).toLocaleDateString(
                "en-US",
                { month: "short" },
              )}
            </span>
          ))}
        </div>
      </div>
      {!hasActivity && (
        <p className="drawer-muted item-chart-empty">
          No linked spending in these months yet.
        </p>
      )}
      {hasRefunds && (
        <p className="drawer-muted">Negative bars show net refunds.</p>
      )}
      {hasPending && (
        <p className="drawer-muted">
          Net spending includes pending transactions.
        </p>
      )}
      <details className="item-chart-values">
        <summary>View monthly amounts</summary>
        <table>
          <caption className="sr-only">
            Monthly item net spending and planned amounts
          </caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Net spent</th>
              {hasPlan && <th scope="col">Planned</th>}
            </tr>
          </thead>
          <tbody>
            {history.map((entry) => (
              <tr key={entry.month}>
                <th scope="row">{monthLabel(entry.month)}</th>
                <td>{money(entry.spent_cents)}</td>
                {hasPlan && (
                  <td>
                    {entry.has_plan === false
                      ? "—"
                      : money(entry.planned_cents)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
