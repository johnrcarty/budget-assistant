import { money } from "../lib/format.js";

export function observationDate(value) {
  if (!value) return "Unknown date";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AccountHistoryChart({
  points = [],
  currency = "USD",
  valueKey = "net_worth_cents",
  label = "Net worth",
  id = "account-history",
  netWorth = false,
}) {
  const ordered = points
    .filter((point) => !point.superseded_by_provider)
    .sort((a, b) =>
      String(a.effective_at || a.observed_at).localeCompare(
        String(b.effective_at || b.observed_at),
      ),
    );
  const values = ordered.filter((point) => typeof point[valueKey] === "number");
  const latest = values.at(-1);
  const low = Math.min(0, ...values.map((point) => point[valueKey]));
  const high = Math.max(0, ...values.map((point) => point[valueKey]));
  const range = high - low || 1;
  const times = ordered.map((point) =>
    new Date(point.effective_at || point.observed_at).getTime(),
  );
  const firstTime = Math.min(...times);
  const lastTime = Math.max(...times);
  const x = (point) =>
    times.length === 1 || firstTime === lastTime
      ? 330
      : 18 +
        ((new Date(point.effective_at || point.observed_at).getTime() -
          firstTime) /
          (lastTime - firstTime)) *
          624;
  const y = (point) =>
    high === low ? 89 : 16 + ((high - point[valueKey]) / range) * 146;
  const segments = [];
  let segment = [];
  for (const point of ordered) {
    if (typeof point[valueKey] === "number") segment.push(point);
    else if (segment.length) {
      segments.push(segment);
      segment = [];
    }
  }
  if (segment.length) segments.push(segment);
  const complete = ordered.every((point) => point.complete !== false);
  return (
    <section className="balance-history-chart" aria-labelledby={`${id}-title`}>
      <div className="balance-chart-heading">
        <h3 id={`${id}-title`}>{label}</h3>
        {latest && <strong>{money(latest[valueKey], currency)}</strong>}
      </div>
      {!values.length ? (
        <p className="balance-chart-empty">
          History starts with the first recorded balance. No earlier values are
          assumed.
        </p>
      ) : (
        <>
          <p className="balance-chart-caption">
            {observationDate(ordered[0].effective_at || ordered[0].observed_at)}{" "}
            –{" "}
            {observationDate(
              ordered.at(-1).effective_at || ordered.at(-1).observed_at,
            )}{" "}
            · {currency}
          </p>
          <div
            className="balance-chart-plot"
            role="img"
            aria-label={`${label} from recorded observations in ${currency}. ${values.length} observations. Exact dates, balances and coverage are available below.`}
          >
            <svg
              viewBox="0 0 660 178"
              aria-hidden="true"
              preserveAspectRatio="none"
            >
              {[16, 89, 162].map((position) => (
                <line
                  className="balance-chart-grid"
                  key={position}
                  x1="18"
                  x2="642"
                  y1={position}
                  y2={position}
                />
              ))}
              {low < 0 && (
                <line
                  className="balance-chart-zero"
                  x1="18"
                  x2="642"
                  y1={16 + (high / range) * 146}
                  y2={16 + (high / range) * 146}
                />
              )}
              {segments
                .filter((segment) => segment.length > 1)
                .map((segment, index) => (
                  <polyline
                    className="balance-chart-line"
                    key={index}
                    points={segment
                      .map((point) => `${x(point)},${y(point)}`)
                      .join(" ")}
                  />
                ))}
              {values.map((point, index) => (
                <circle
                  className={
                    point.complete === false
                      ? "balance-chart-point partial"
                      : "balance-chart-point"
                  }
                  key={`${point.observed_at}-${index}`}
                  cx={x(point)}
                  cy={y(point)}
                  r="3.5"
                >
                  <title>
                    {observationDate(point.effective_at || point.observed_at)}:{" "}
                    {money(point[valueKey], currency)}
                  </title>
                </circle>
              ))}
            </svg>
          </div>
          <div className="balance-chart-axis">
            <span>Low {money(low, currency)}</span>
            <span>High {money(high, currency)}</span>
          </div>
          <p className="balance-chart-caption">
            Recorded balances only. Lines connect observations; values before
            the first observation are unknown.
            {netWorth && !complete
              ? " Open dots show partial account coverage."
              : ""}
          </p>
          {netWorth && latest && (
            <p className="balance-coverage">
              {latest.observed_accounts} of {latest.total_accounts} accounts
              observed ·{" "}
              {latest.complete ? "Complete coverage" : "Partial coverage"}
            </p>
          )}
          <details className="balance-chart-values">
            <summary>View observations</summary>
            <div className="balance-observations">
              <table>
                <caption className="sr-only">
                  {label} observations in {currency}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">As of</th>
                    <th scope="col">{label}</th>
                    {netWorth && <th scope="col">Coverage</th>}
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((point, index) => (
                    <tr key={`${point.observed_at}-${index}`}>
                      <th scope="row">
                        {observationDate(
                          point.effective_at || point.observed_at,
                        )}
                        {point.is_baseline && (
                          <small>
                            Initial stored balance · bank date unknown
                          </small>
                        )}
                        {point.provider_as_of && (
                          <small>
                            Bank as of · read{" "}
                            {observationDate(point.observed_at)}
                          </small>
                        )}
                      </th>
                      <td>
                        {point[valueKey] == null
                          ? "Unknown"
                          : money(point[valueKey], currency)}
                      </td>
                      {netWorth && (
                        <td>
                          {point.observed_accounts}/{point.total_accounts}
                          {!point.complete && <small>Partial</small>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
