import {
  ArrowLeftRight,
  ArrowUpRight,
  Plus,
  X,
  Search,
  Pencil,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { money, prettyDate } from "../lib/format.js";
import { IconButton, Button, Empty } from "../components/ui.jsx";
export default function Transactions({
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
    <section className="card transactions-card">
      <div className="card-heading">
        <div>
          <p className="eyebrow">EVERY LITTLE MOMENT</p>
          <h2>Your transactions</h2>
        </div>
        <div className="header-actions">
          <Button
            variant="secondary"
            icon={RefreshCw}
            busy={busy}
            onClick={sync}
            disabled={!settings.simplefin_connected}
          >
            Sync
          </Button>
          <Button icon={Plus} onClick={() => open("transaction")}>
            Add transaction
          </Button>
        </div>
      </div>
      <div className="table-toolbar">
        <label className="search-box">
          <Search size={17} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search transactions…"
            aria-label="Search transactions"
          />
          {filter && (
            <IconButton label="Clear search" onClick={() => setFilter("")}>
              <X size={15} />
            </IconButton>
          )}
        </label>
        <span className="muted small">
          {displayTransactions.length} transactions ·{" "}
          {
            transactions.filter((t) => !t.category_id && t.amount_cents < 0)
              .length
          }{" "}
          to categorize
        </span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Transaction</th>
              <th>Date</th>
              <th>Account</th>
              <th>Purpose</th>
              <th className="align-right">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {displayTransactions.map((t) => (
              <tr key={t.id}>
                <td>
                  <div className="table-name">
                    <span
                      className={`table-icon ${t.amount_cents > 0 ? "income" : ""}`}
                    >
                      {t.amount_cents > 0 ? (
                        <ArrowUpRight size={17} />
                      ) : (
                        <ArrowLeftRight size={17} />
                      )}
                    </span>
                    <div>
                      <button
                        className="row-name-button"
                        onClick={() => open("transaction", t)}
                      >
                        {t.description}
                      </button>
                      {t.pending && <small>Pending</small>}
                    </div>
                  </div>
                </td>
                <td className="nowrap">{prettyDate(t.date)}</td>
                <td>{t.account_name || "Manual"}</td>
                <td>
                  <button
                    className={`category-chip ${!t.category_id ? "uncategorized" : ""}`}
                    onClick={() => open("transaction", t)}
                  >
                    {t.category_name || "Choose a purpose"}
                    <Pencil size={11} />
                  </button>
                </td>
                <td
                  className={`align-right strong nowrap ${t.amount_cents > 0 ? "amount-positive" : ""}`}
                >
                  {t.amount_cents > 0 ? "+" : ""}
                  {money(t.amount_cents)}
                </td>
                <td>
                  <IconButton
                    label={`Delete ${t.description}`}
                    onClick={() => deleteItem("transaction", t)}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!displayTransactions.length && (
        <Empty
          title={filter ? "Nothing here just yet." : "Your story starts here."}
          description={
            filter
              ? "Try another description, account, or purpose."
              : "Add a transaction or connect your accounts through SimpleFIN."
          }
          action={
            !filter && (
              <Button icon={Plus} onClick={() => open("transaction")}>
                Add transaction
              </Button>
            )
          }
        />
      )}
    </section>
  );
}
