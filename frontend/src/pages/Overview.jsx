import {
  Wallet,
  CalendarDays,
  ArrowLeftRight,
  ArrowUpRight,
  Plus,
  Check,
  Leaf,
  LockKeyhole,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { money, today, monthLabel, colors } from "../lib/format.js";
import {
  Button,
  Empty,
  Stat,
  Progress,
  TransactionRow,
} from "../components/ui.jsx";
import Sankey from "../components/Sankey.jsx";
export default function Overview({
  scope,
  dash,
  groups,
  transactions,
  bills,
  accounts,
  settings,
  month,
  user,
  data,
  remaining,
  billSummary,
  unpaid,
  busy,
  filter,
  setFilter,
  flowSpent,
  setFlowSpent,
  haToken,
  navigate,
  open,
  paid,
  deleteItem,
  sync,
  share,
  generateToken,
  notify,
  displayTransactions,
}) {
  const glanceGroups = groups.filter(
    (group) =>
      group.source !== "saved" ||
      (group.items?.length || 0) > 0 ||
      (group.planned_cents || 0) !== 0 ||
      (group.spent_cents || 0) !== 0 ||
      (group.historical_item_spent_cents || 0) !== 0,
  );
  const flowGroups = [...groups];
  if (dash.shared_personal?.contributors > 0)
    flowGroups.push({
      name: "Shared personal totals",
      color: "#8c9080",
      planned_cents: dash.shared_personal.planned_cents,
      spent_cents: dash.shared_personal.spent_cents,
    });
  const uncategorized = Math.max(
    0,
    (dash.spent_cents || 0) -
      flowGroups.reduce((sum, g) => sum + Math.max(0, g.spent_cents || 0), 0),
  );
  if (uncategorized > 0)
    flowGroups.push({
      name: "Uncategorized",
      color: "#b5a899",
      planned_cents: 0,
      spent_cents: uncategorized,
    });
  return (
    <>
      <div className="stat-grid">
        <Stat
          label="Monthly income"
          value={money(dash.income_cents)}
          note="A foundation for your plan"
          icon={ArrowUpRight}
          tone="green"
        />
        <Stat
          label="Assigned to a purpose"
          value={money(dash.planned_cents)}
          note={
            (dash.unassigned_cents || 0) >= 0
              ? `${money(dash.unassigned_cents)} still to assign`
              : `${money(Math.abs(dash.unassigned_cents))} over income`
          }
          icon={Wallet}
          tone="gold"
        />
        <Stat
          label="Spent so far"
          value={money(dash.spent_cents)}
          note={`${monthLabel(month).split(" ")[0]} activity`}
          icon={ArrowLeftRight}
          tone="rust"
        />
        <Stat
          label="Left in your plan"
          value={money(remaining)}
          note={
            remaining >= 0
              ? "Planned minus spent"
              : "Spending is above your plan"
          }
          icon={Leaf}
          tone="sage"
          featured
        />
      </div>
      <div className="overview-main-grid">
        <section className="card flow-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">FOLLOW THE FLOW</p>
              <h2>Where your money goes</h2>
            </div>
            <div className="mini-toggle">
              <button
                className={!flowSpent ? "active" : ""}
                onClick={() => setFlowSpent(false)}
              >
                Plan
              </button>
              <button
                className={flowSpent ? "active" : ""}
                onClick={() => setFlowSpent(true)}
              >
                Activity
              </button>
            </div>
          </div>
          <p className="card-description">
            From what comes in to what matters most.
          </p>
          <Sankey
            income={dash.income_cents || 0}
            groups={flowGroups}
            spent={flowSpent}
          />
          <div className="flow-footer">
            <span>
              <span className="legend-dot" />
              {flowSpent
                ? "Expected income → spending so far"
                : "Income → your plan → every purpose"}
            </span>
            <button className="text-button" onClick={() => navigate("budget")}>
              Shape your budget
              <ArrowUpRight size={14} />
            </button>
          </div>
        </section>
        <section className="card upcoming-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">A STEP AHEAD</p>
              <h2>On the horizon</h2>
            </div>
            <span className="round-icon">
              <CalendarDays size={19} />
            </span>
          </div>
          <div className="bill-pulse">
            <div>
              <strong>
                {money(
                  (billSummary.today?.total_cents || 0) +
                    (billSummary.this_week?.total_cents || 0),
                )}
              </strong>
              <span>due today & this week</span>
            </div>
            <span className="pill neutral">
              {(billSummary.today?.count || 0) +
                (billSummary.this_week?.count || 0)}{" "}
              bills
            </span>
          </div>
          {billSummary.past_due?.count > 0 && (
            <button
              className="overdue-callout"
              onClick={() => navigate("bills")}
            >
              <AlertCircle size={15} />
              {billSummary.past_due.count} past due ·{" "}
              {money(billSummary.past_due.total_cents)}
              <ArrowRight size={14} />
            </button>
          )}
          <div className="upcoming-list">
            {unpaid.slice(0, 4).map((b) => (
              <div className="upcoming-row" key={b.id}>
                <span
                  className={`due-date ${b.bucket === "past_due" ? "late" : ""}`}
                >
                  <strong>
                    {new Date(`${b.due_date}T12:00:00`).getDate()}
                  </strong>
                  <small>
                    {new Date(`${b.due_date}T12:00:00`).toLocaleDateString(
                      "en-US",
                      {
                        month: "short",
                      },
                    )}
                  </small>
                </span>
                <div>
                  <strong>{b.name}</strong>
                  <small>
                    {b.autopay
                      ? "Autopay"
                      : b.bucket === "past_due"
                        ? "Past due"
                        : "Mark paid when settled"}
                  </small>
                </div>
                <div className="bill-row-end">
                  <strong>{money(b.amount_cents)}</strong>
                  <button
                    className="paid-button"
                    onClick={() => paid(b)}
                    disabled={busy}
                    aria-label={`Mark ${b.name} paid`}
                    title="Mark paid"
                  >
                    <Check size={14} />
                  </button>
                </div>
              </div>
            ))}
            {!unpaid.length && (
              <div className="quiet-empty">
                <CheckCircle2 size={28} />
                <h3>All caught up.</h3>
                <p>A little less on your mind.</p>
              </div>
            )}
          </div>
          <button
            className="card-bottom-link"
            onClick={() => navigate("bills")}
          >
            View all bills
            <ArrowRight size={15} />
          </button>
        </section>
      </div>
      <div className="overview-bottom-grid">
        <section className="card budget-glance">
          <div className="card-heading">
            <div>
              <p className="eyebrow">THE EVERYDAY BALANCE</p>
              <h2>Your plan, at a glance</h2>
            </div>
            <button className="text-button" onClick={() => navigate("budget")}>
              View budget
              <ArrowUpRight size={14} />
            </button>
          </div>
          {glanceGroups.slice(0, 5).map((g, i) => (
            <div className="glance-row" key={g.id || g.name}>
              <div className="glance-label">
                <span
                  className="category-dot"
                  style={{
                    background: g.color || colors[i % colors.length],
                  }}
                />
                <strong>{g.name}</strong>
                <span>
                  {money(g.spent_cents)}{" "}
                  <small>/ {money(g.planned_cents)}</small>
                </span>
              </div>
              <Progress
                value={g.spent_cents}
                total={g.planned_cents}
                color={g.color || colors[i % colors.length]}
              />
            </div>
          ))}
          {!glanceGroups.length && (
            <Empty
              title="Start with what matters"
              description="Start with a category, then add its budget items."
              action={
                <Button
                  variant="secondary"
                  onClick={() => navigate("budget")}
                  icon={Plus}
                >
                  Open budget
                </Button>
              }
            />
          )}
        </section>
        <section className="card recent-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">LIFE, LATELY</p>
              <h2>Recent transactions</h2>
            </div>
            <button
              className="text-button"
              onClick={() => navigate("transactions")}
            >
              View all
              <ArrowUpRight size={14} />
            </button>
          </div>
          {(dash.recent_transactions || transactions.slice(0, 5))
            .slice(0, 5)
            .map((t) => (
              <TransactionRow
                key={t.id}
                transaction={t}
                onClick={() => open("transaction", t)}
                compact
              />
            ))}
          {!transactions.length && (
            <Empty
              title="A fresh beginning"
              description="Connect SimpleFIN or add your first transaction."
              action={
                <Button
                  variant="secondary"
                  onClick={() => open("transaction")}
                  icon={Plus}
                >
                  Add transaction
                </Button>
              }
            />
          )}
        </section>
      </div>
      {scope === "household" && dash.shared_personal?.contributors > 0 && (
        <div className="shared-note">
          <LockKeyhole size={16} />
          <p>
            <strong>Personal totals are included.</strong>{" "}
            {dash.shared_personal.contributors} member
            {dash.shared_personal.contributors === 1 ? "" : "s"} sharing{" "}
            {money(dash.shared_personal.spent_cents)} in spending. Their
            individual items stay private.
          </p>
        </div>
      )}
    </>
  );
}
