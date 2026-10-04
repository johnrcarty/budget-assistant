import { useEffect, useRef, useState } from "react";
import {
  X,
  Pencil,
  Check,
  RefreshCw,
  Link2,
  Unlink,
  Plus,
  CalendarDays,
  LoaderCircle,
  AlertCircle,
  Clock3,
} from "lucide-react";
import { api } from "../lib/api.js";
import { cents, money, monthLabel, prettyDate, today } from "../lib/format.js";
import { Button, Field, IconButton } from "./ui.jsx";
import ItemSpendingChart from "./ItemSpendingChart.jsx";

export default function ItemDetails({
  initialItem,
  scope,
  month,
  user,
  transactions,
  accounts,
  onClose,
  onEditItem,
  onChanged,
  notify,
}) {
  const dialog = useRef(null);
  const mounted = useRef(false);
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [errorSection, setErrorSection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dueDay, setDueDay] = useState("");
  const [existingBill, setExistingBill] = useState("");
  const [transactionMode, setTransactionMode] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedTransaction, setSelectedTransaction] = useState("");
  const [confirmMove, setConfirmMove] = useState(false);
  const path = `budget/items/${initialItem.id}`;
  const query = `scope=${scope}&month=${month}`;

  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.current.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.current?.close();
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    setLoading(true);
    setLoadError("");
    api(`${path}/details?${query}`, { signal: abort.signal })
      .then((result) => {
        if (!mounted.current || abort.signal.aborted) return;
        if (result.item.month !== month)
          throw new Error("Open this item in the month it belongs to.");
        setDetails(result);
        setDueDay(
          result.due.due_day === null ? "" : String(result.due.due_day),
        );
      })
      .catch((failure) => {
        if (mounted.current && !abort.signal.aborted)
          setLoadError(failure.message);
      })
      .finally(() => {
        if (mounted.current && !abort.signal.aborted) setLoading(false);
      });
    return () => {
      mounted.current = false;
      abort.abort();
    };
  }, [path, query, revision]);

  async function write(suffix, method, body, message, after) {
    setBusy(true);
    setError("");
    setErrorSection(
      suffix === "due"
        ? "due"
        : suffix === "payment"
          ? "payment"
          : "transactions",
    );
    try {
      const result = await api(`${path}/${suffix}?${query}`, { method, body });
      if (mounted.current) {
        setDetails(result);
        after?.(result);
      }
      notify(message);
      await onChanged();
      return result;
    } catch (failure) {
      if (mounted.current) setError(failure.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function saveDue(event) {
    event.preventDefault();
    await write(
      "due",
      "PUT",
      {
        due_day:
          dueDay === "" ? null : dueDay === "last" ? "last" : Number(dueDay),
        ...(existingBill ? { existing_bill_id: Number(existingBill) } : {}),
      },
      dueDay
        ? "Monthly due date saved."
        : "Due schedule removed. Existing payment facts are kept.",
      (result) => {
        setDueDay(
          result.due.due_day === null ? "" : String(result.due.due_day),
        );
        setExistingBill("");
      },
    );
  }
  async function linkTransaction(event) {
    event.preventDefault();
    if (!selectedTransaction) return;
    await write(
      `transactions/${selectedTransaction}/link`,
      "POST",
      { replace_existing: confirmMove },
      "Transaction linked to this item.",
      () => {
        setTransactionMode(null);
        setSelectedTransaction("");
        setConfirmMove(false);
        setSearch("");
      },
    );
  }
  async function addTransaction(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const selectedAccount = accounts.find(
      (account) => account.id === Number(values.account_id),
    );
    await write(
      "transactions",
      "POST",
      {
        description: values.description,
        amount_cents:
          cents(values.amount) * (values.direction === "income" ? 1 : -1),
        date: values.date,
        account_name: selectedAccount?.name || "Manual entry",
        ...(values.account_id ? { account_id: Number(values.account_id) } : {}),
        pending: false,
      },
      "Transaction added and linked.",
      () => setTransactionMode(null),
    );
  }
  function chooseBill(id) {
    setExistingBill(id);
    if (id) {
      const bill = details.available_bills.find(
        (entry) => entry.id === Number(id),
      );
      if (bill) setDueDay(String(Number(bill.due_date.slice(8, 10))));
    }
  }
  function close() {
    if (!busy) onClose();
  }
  const operationError = (section) =>
    error &&
    errorSection === section && (
      <p className="inline-error item-drawer-operation-error" role="alert">
        <AlertCircle size={16} />
        {error}
      </p>
    );
  const item = details?.item || initialItem;
  const due = details?.due;
  const linked = details?.linked_transactions || [];
  const linkedIds = new Set(linked.map((transaction) => transaction.id));
  const candidates = transactions.filter(
    (transaction) =>
      transaction.date?.slice(0, 7) === month &&
      !linkedIds.has(transaction.id) &&
      (!transaction.currency || transaction.currency === "USD") &&
      `${transaction.description} ${transaction.account_name || ""} ${transaction.category_name || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const chosen = candidates.find(
    (transaction) => transaction.id === Number(selectedTransaction),
  );
  const reassigned = chosen?.category_id && chosen.category_id !== item.id;
  const currentDate = today(user.timezone);
  const transactionDate =
    currentDate.slice(0, 7) === month ? currentDate : `${month}-01`;
  const lastDay = new Date(`${month}-15T12:00:00`);
  lastDay.setMonth(lastDay.getMonth() + 1, 0);
  const dateMax = `${month}-${String(lastDay.getDate()).padStart(2, "0")}`;
  const pending = item.pending_cents || 0;
  const canAdopt =
    due?.can_adopt_existing_bill === true &&
    (details?.available_bills?.length || 0) > 0;

  return (
    <dialog
      ref={dialog}
      className="item-drawer"
      aria-labelledby="item-details-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          close();
      }}
    >
      <header className="item-drawer-header">
        <div>
          <span className="item-drawer-category">
            <i
              style={{
                background: details?.category.color || item.color || "#52705a",
              }}
            />
            {details?.category.name || item.group_name || "Budget item"}
          </span>
          <h2 id="item-details-title">{item.name}</h2>
          <p className="item-drawer-month">
            {monthLabel(month)}
            {scope === "personal" ? " · Only you" : " · Household"}
          </p>
        </div>
        <div className="item-drawer-actions">
          <IconButton
            label={`Edit ${item.name} item`}
            onClick={() => onEditItem(item)}
            disabled={busy || !details}
          >
            <Pencil size={18} />
          </IconButton>
          <IconButton
            label="Close item details"
            onClick={close}
            disabled={busy}
          >
            <X size={21} />
          </IconButton>
        </div>
      </header>
      {loading ? (
        <div className="item-drawer-loading" role="status">
          <LoaderCircle size={23} className="spinning" />
          <p className="drawer-muted">Loading this item…</p>
        </div>
      ) : loadError ? (
        <div className="item-drawer-error" role="alert">
          <AlertCircle size={22} />
          <p>{loadError}</p>
          <Button
            variant="secondary"
            onClick={() => setRevision((value) => value + 1)}
          >
            Try again
          </Button>
        </div>
      ) : (
        details && (
          <div className="item-drawer-content">
            <div className="item-drawer-totals">
              <div>
                <span>Planned</span>
                <strong>{money(item.planned_cents)}</strong>
              </div>
              <div>
                <span>Net spent</span>
                <strong>{money(item.spent_cents)}</strong>
              </div>
              <div>
                <span>Remaining</span>
                <strong
                  className={
                    item.planned_cents - item.spent_cents < 0
                      ? "amount-negative"
                      : ""
                  }
                >
                  {money(item.planned_cents - item.spent_cents)}
                </strong>
              </div>
            </div>
            {pending !== 0 && (
              <p className="drawer-muted item-pending-note">
                <Clock3 size={14} />
                Includes {money(pending)} in pending net spending.
              </p>
            )}
            <section
              className="item-drawer-section"
              aria-labelledby="item-payment-title"
            >
              <div className="drawer-section-heading">
                <h3 id="item-payment-title">This month’s payment</h3>
              </div>
              <div className="item-payment-status">
                <div>
                  <strong>{due.paid ? "Paid" : "Not marked paid"}</strong>
                  <p className="drawer-muted">
                    {due.due_date
                      ? `${due.bucket === "past_due" && !due.paid ? "Past due · " : "Due "}${prettyDate(due.due_date)} · ${money(due.amount_cents)}`
                      : "No due date set"}
                  </p>
                </div>
                <Button
                  variant={due.paid ? "secondary" : ""}
                  icon={due.paid ? RefreshCw : Check}
                  busy={busy}
                  aria-label={`${due.paid ? "Mark unpaid" : "Mark paid"}: ${item.name}, ${monthLabel(month)}`}
                  onClick={() =>
                    write(
                      "payment",
                      "PATCH",
                      { paid: !due.paid },
                      due.paid
                        ? "Item marked unpaid for this month."
                        : "Item marked paid for this month.",
                    )
                  }
                >
                  {due.paid ? "Mark unpaid" : "Mark paid"}
                </Button>
              </div>
              <p className="drawer-muted item-due-help">
                You confirm paid status. Linking a transaction does not change
                it.
              </p>
              {operationError("payment")}
            </section>
            <section
              className="item-drawer-section"
              aria-labelledby="item-schedule-title"
            >
              <div className="drawer-section-heading">
                <h3 id="item-schedule-title">Monthly due date</h3>
                <CalendarDays size={17} aria-hidden="true" />
              </div>
              <form onSubmit={saveDue}>
                {canAdopt && (
                  <Field
                    label="Existing bill reminder"
                    help="Use a bill already tracked here to avoid a second reminder."
                  >
                    <select
                      value={existingBill}
                      onChange={(event) => chooseBill(event.target.value)}
                      disabled={busy}
                    >
                      <option value="">Create a reminder for this item</option>
                      {details.available_bills.map((bill) => (
                        <option key={bill.id} value={bill.id}>
                          {bill.name} · {prettyDate(bill.due_date)} ·{" "}
                          {money(bill.amount_cents)}
                          {bill.paid ? " · Paid" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <div className="item-schedule-form">
                  <Field label="Due day (optional)">
                    <select
                      value={dueDay}
                      onChange={(event) => {
                        setDueDay(event.target.value);
                        if (!event.target.value) setExistingBill("");
                      }}
                      disabled={busy}
                    >
                      <option value="">No due date</option>
                      {Array.from({ length: 31 }, (_, index) => (
                        <option key={index + 1} value={index + 1}>
                          {index + 1}
                        </option>
                      ))}
                      <option value="last">Last day of the month</option>
                    </select>
                  </Field>
                  <Button type="submit" variant="secondary" busy={busy}>
                    Save
                  </Button>
                </div>
                <p className="drawer-muted item-due-help">
                  Applies from {monthLabel(month)} forward. Short months use
                  their last day; prior months’ unpaid reminders and paid
                  history are kept.
                </p>
                {operationError("due")}
              </form>
            </section>
            <section
              className="item-drawer-section"
              aria-labelledby="item-transactions-title"
            >
              <div className="drawer-section-heading">
                <h3 id="item-transactions-title">Linked transactions</h3>
                <span>{linked.length}</span>
              </div>
              <div className="item-linked-list">
                {linked.map((transaction) => (
                  <div className="item-linked-row" key={transaction.id}>
                    <div>
                      <strong>{transaction.description}</strong>
                      <small>
                        {prettyDate(transaction.date)} ·{" "}
                        {transaction.account_name || "Manual entry"}
                      </small>
                      {transaction.pending && (
                        <span className="item-pending">
                          <Clock3 size={12} />
                          Pending
                        </span>
                      )}
                    </div>
                    <span>
                      {money(
                        transaction.amount_cents,
                        transaction.currency || "USD",
                      )}
                    </span>
                    <IconButton
                      label={`Unlink ${transaction.description} transaction`}
                      disabled={busy}
                      onClick={() =>
                        write(
                          `transactions/${transaction.id}/link`,
                          "DELETE",
                          undefined,
                          "Transaction unlinked; the record is kept.",
                        )
                      }
                    >
                      <Unlink size={16} />
                    </IconButton>
                  </div>
                ))}
              </div>
              {!linked.length && (
                <p className="drawer-muted">
                  No transactions linked for this month.
                </p>
              )}
              <div className="item-transaction-tools">
                <Button
                  variant="secondary"
                  icon={Link2}
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setTransactionMode("link");
                  }}
                >
                  Link existing
                </Button>
                <Button
                  variant="ghost"
                  icon={Plus}
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setTransactionMode("add");
                  }}
                >
                  Add transaction
                </Button>
              </div>
              {transactionMode === "link" && (
                <form className="item-drawer-form" onSubmit={linkTransaction}>
                  <fieldset disabled={busy}>
                    <legend className="sr-only">
                      Link an existing transaction
                    </legend>
                    <Field label="Search transactions">
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => {
                          setSearch(event.target.value);
                          setSelectedTransaction("");
                          setConfirmMove(false);
                        }}
                        placeholder="Description, account, or item"
                      />
                    </Field>
                    <Field label="Transaction">
                      <select
                        required
                        value={selectedTransaction}
                        onChange={(event) => {
                          setSelectedTransaction(event.target.value);
                          setConfirmMove(false);
                        }}
                        disabled={busy}
                      >
                        <option value="">
                          {candidates.length
                            ? "Choose a transaction"
                            : "No matching USD transactions this month"}
                        </option>
                        {candidates.map((transaction) => (
                          <option key={transaction.id} value={transaction.id}>
                            {prettyDate(transaction.date)} ·{" "}
                            {transaction.description} ·{" "}
                            {money(transaction.amount_cents)}
                            {transaction.pending ? " · Pending" : ""}
                            {transaction.category_name
                              ? ` · ${transaction.category_name}`
                              : " · Uncategorized"}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {reassigned && (
                      <>
                        <p className="item-reassign-note">
                          This transaction is linked to{" "}
                          {chosen.category_name || "another item"}. Moving it
                          changes that item’s spending.
                        </p>
                        <label className="checkbox-field">
                          <input
                            type="checkbox"
                            required
                            checked={confirmMove}
                            onChange={(event) =>
                              setConfirmMove(event.target.checked)
                            }
                          />
                          <span>Move this transaction to {item.name}</span>
                        </label>
                      </>
                    )}
                    <div className="item-drawer-form-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setTransactionMode(null)}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        icon={Link2}
                        busy={busy}
                        disabled={!chosen || (reassigned && !confirmMove)}
                      >
                        {reassigned ? "Move and link" : "Link transaction"}
                      </Button>
                    </div>
                  </fieldset>
                </form>
              )}
              {transactionMode === "add" && (
                <form className="item-drawer-form" onSubmit={addTransaction}>
                  <fieldset disabled={busy}>
                    <legend className="sr-only">
                      Add and link a transaction
                    </legend>
                    <Field label="Description">
                      <input
                        name="description"
                        required
                        maxLength={200}
                        defaultValue={item.name}
                      />
                    </Field>
                    <div className="form-grid">
                      <Field label="Amount">
                        <div className="money-input">
                          <span>$</span>
                          <input
                            name="amount"
                            type="number"
                            required
                            min="0.01"
                            step="0.01"
                            placeholder="0.00"
                            defaultValue={
                              item.planned_cents > item.spent_cents
                                ? (
                                    (item.planned_cents - item.spent_cents) /
                                    100
                                  ).toFixed(2)
                                : ""
                            }
                          />
                        </div>
                      </Field>
                      <Field label="Direction">
                        <select name="direction" defaultValue="expense">
                          <option value="expense">Money out</option>
                          <option value="income">Money in / refund</option>
                        </select>
                      </Field>
                    </div>
                    <Field label="Date">
                      <input
                        name="date"
                        required
                        type="date"
                        min={`${month}-01`}
                        max={dateMax}
                        defaultValue={transactionDate}
                      />
                    </Field>
                    <Field label="Account">
                      <select name="account_id" defaultValue="">
                        <option value="">Manual entry</option>
                        {accounts
                          .filter((account) => account.currency === "USD")
                          .map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <p className="drawer-muted">
                      A USD transaction for {monthLabel(month)}. It will be
                      linked to this item.
                    </p>
                    <div className="item-drawer-form-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setTransactionMode(null)}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" icon={Plus} busy={busy}>
                        Add and link
                      </Button>
                    </div>
                  </fieldset>
                </form>
              )}
              {operationError("transactions")}
            </section>
            <ItemSpendingChart
              history={details.history}
              color={details.category.color}
            />
          </div>
        )
      )}
    </dialog>
  );
}
