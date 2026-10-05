import {
  Plus,
  X,
  Search,
  Trash2,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { money } from "../lib/format.js";
import { IconButton, Button, Empty } from "../components/ui.jsx";

function dateLabel(date) {
  return new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function Transactions({
  settings,
  busy,
  filter,
  setFilter,
  open,
  deleteItem,
  sync,
  displayTransactions,
  openRules,
}) {
  const dates = new Map();
  [...displayTransactions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .forEach((transaction) => {
      const date = transaction.date.slice(0, 10);
      if (!dates.has(date)) dates.set(date, []);
      dates.get(date).push(transaction);
    });
  const uncategorized = displayTransactions.filter(
    (transaction) => !transaction.category_id && transaction.amount_cents < 0,
  ).length;
  return (
    <section className="card transactions-card compact-transactions">
      <div className="card-heading">
        <h2>Transactions</h2>
        <div className="header-actions">
          <Button
            variant="secondary"
            icon={RefreshCw}
            busy={busy}
            onClick={sync}
            disabled={!settings.simplefin_connected}
            aria-label="Sync transactions"
            className="transaction-sync"
          >
            <span className="transaction-sync-label">Sync</span>
          </Button>
          <Button
            icon={Plus}
            aria-label="Add transaction"
            onClick={() => open("transaction")}
          >
            <span className="transaction-add-wide">Add transaction</span>
            <span className="transaction-add-mobile">Add</span>
          </Button>
        </div>
      </div>
      <div className="transaction-search">
        <div className="transaction-search-line">
          <label className="search-box">
            <Search size={17} aria-hidden="true" />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search transactions…"
              aria-label="Search transactions"
            />
            {filter && (
              <IconButton label="Clear search" onClick={() => setFilter("")}>
                <X size={15} />
              </IconButton>
            )}
          </label>
          <Button
            variant="secondary"
            icon={SlidersHorizontal}
            onClick={() => openRules()}
            disabled={busy}
          >
            Rules
          </Button>
        </div>
        <p>
          Checking, savings & credit · Manual entries
          {uncategorized > 0 && <span>{uncategorized} to categorize</span>}
        </p>
      </div>
      <div className="transaction-dates">
        {[...dates.entries()].map(([date, entries]) => (
          <section className="transaction-date-group" key={date}>
            <h3>
              <time dateTime={date}>{dateLabel(date)}</time>
              <span>{entries.length}</span>
            </h3>
            <ul>
              {entries.map((transaction) => (
                <li className="compact-transaction-row" key={transaction.id}>
                  <button
                    type="button"
                    className="transaction-open"
                    onClick={() => open("transaction", transaction)}
                    disabled={busy}
                    aria-label={`Edit ${transaction.description}, ${money(transaction.amount_cents, transaction.currency || "USD")}, ${dateLabel(date)}${transaction.pending ? ", pending" : ""}`}
                  >
                    <span className="transaction-copy">
                      <strong>{transaction.description}</strong>
                      <span className="transaction-metadata">
                        <span>
                          {transaction.account_name || "Manual entry"}
                        </span>
                        <span
                          className={
                            !transaction.category_id ? "needs-purpose" : ""
                          }
                        >
                          {transaction.category_name ||
                            (transaction.manual_category_lock
                              ? "Kept uncategorized"
                              : "Uncategorized")}
                        </span>
                        <span
                          className={`transaction-provenance ${transaction.category_source === "automatic" ? "is-automatic" : ""}`}
                        >
                          {transaction.category_source === "automatic"
                            ? "Automatic"
                            : transaction.category_source === "manual"
                              ? "Manual"
                              : "Unmatched"}
                        </span>
                        {transaction.pending && (
                          <span className="transaction-pending">Pending</span>
                        )}
                      </span>
                    </span>
                    <strong
                      className={`transaction-amount ${transaction.amount_cents > 0 ? "amount-positive" : ""}`}
                    >
                      {transaction.amount_cents > 0 ? "+" : ""}
                      {money(
                        transaction.amount_cents,
                        transaction.currency || "USD",
                      )}
                    </strong>
                  </button>
                  <IconButton
                    label={`Delete ${transaction.description}, ${dateLabel(date)}`}
                    onClick={() => deleteItem("transaction", transaction)}
                    disabled={busy}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {!displayTransactions.length && (
        <Empty
          title={
            filter ? "No matching transactions." : "No transactions here yet."
          }
          description={
            filter
              ? "Try another description, account, or purpose."
              : "Checking, savings, credit and manual entries appear here. Other account data stays in Accounts."
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
