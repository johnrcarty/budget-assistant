import {
  CalendarDays,
  Plus,
  Check,
  Pencil,
  Trash2,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { money, today, prettyDate } from "../lib/format.js";
import { IconButton, Button, Empty, Stat } from "../components/ui.jsx";
export default function Bills({
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
  return (
    <>
      <div className="bill-summary-grid">
        {[
          { key: "past_due", label: "Past due", tone: "rust" },
          { key: "today", label: "Due today", tone: "gold" },
          {
            key: "this_week",
            label: "Rest of week",
            tone: "green",
          },
          { key: "next_week", label: "Next week", tone: "sage" },
        ].map((b) => (
          <Stat
            key={b.key}
            label={b.label}
            value={money(billSummary[b.key]?.total_cents)}
            note={`${billSummary[b.key]?.count || 0} unpaid bill${billSummary[b.key]?.count === 1 ? "" : "s"}`}
            icon={b.key === "past_due" ? AlertCircle : CalendarDays}
            tone={b.tone}
          />
        ))}
      </div>
      <section className="card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">KEEP LIFE RUNNING</p>
            <h2>Your bills</h2>
          </div>
          <Button icon={Plus} onClick={() => open("bill")}>
            Add bill
          </Button>
        </div>
        <div className="table-wrap">
          <table className="data-table bill-table">
            <thead>
              <tr>
                <th>Bill</th>
                <th>Due date</th>
                <th>Status</th>
                <th className="align-right">Amount</th>
                <th className="align-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bills
                .slice()
                .sort((a, b) => a.due_date.localeCompare(b.due_date))
                .map((b) => (
                  <tr key={b.id}>
                    <td>
                      <div className="table-name">
                        <span
                          className={`table-icon ${b.paid ? "is-paid" : ""}`}
                        >
                          <CalendarDays size={17} />
                        </span>
                        <div>
                          <strong>{b.name}</strong>
                          <small>
                            {b.recurrence === "monthly"
                              ? "Monthly"
                              : "One time"}
                            {b.autopay ? " · Autopay" : ""}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>{prettyDate(b.due_date)}</td>
                    <td>
                      <span
                        className={`pill ${b.paid ? "green" : b.bucket === "past_due" ? "rust" : b.bucket === "today" ? "gold" : "neutral"}`}
                      >
                        {b.paid
                          ? "Paid"
                          : {
                              past_due: "Past due",
                              today: "Due today",
                              this_week: "This week",
                              next_week: "Next week",
                            }[b.bucket] || "Upcoming"}
                      </span>
                    </td>
                    <td className="align-right strong">
                      {money(b.amount_cents)}
                    </td>
                    <td>
                      <div className="table-actions">
                        <Button
                          variant="ghost"
                          onClick={() => paid(b)}
                          busy={busy}
                          icon={b.paid ? RefreshCw : Check}
                        >
                          {b.paid ? "Undo" : "Mark paid"}
                        </Button>
                        <IconButton
                          label={`Edit ${b.name}`}
                          onClick={() => open("bill", b)}
                        >
                          <Pencil size={15} />
                        </IconButton>
                        <IconButton
                          label={`Delete ${b.name}`}
                          onClick={() => deleteItem("bill", b)}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!bills.length && (
          <Empty
            title="A home without loose ends."
            description="Add your recurring bills and due dates. Home Assistant can help with the remembering."
            action={
              <Button icon={Plus} onClick={() => open("bill")}>
                Add your first bill
              </Button>
            }
          />
        )}
        <div className="table-footer">
          <CalendarDays size={14} />
          <span>
            Weeks run Monday–Sunday, in your household’s time zone. Paid bills
            stay out of reminders.
          </span>
        </div>
      </section>
    </>
  );
}
