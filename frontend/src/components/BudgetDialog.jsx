import { useState } from "react";
import {
  Check,
  Trash2,
  Archive,
  AlertCircle,
  Link2,
  ExternalLink,
  SlidersHorizontal,
} from "lucide-react";
import { Button, Field, Modal } from "./ui.jsx";
import { today, stepMonth, cents } from "../lib/format.js";
export default function BudgetDialog({
  modal,
  user,
  busy,
  dash,
  scope,
  month,
  groups,
  categories = [],
  accounts,
  formError,
  save,
  confirmDelete,
  onCreateRule,
  onUseRules,
  onClose,
}) {
  const [transactionAccount, setTransactionAccount] = useState(
    modal.item?._draft?.account_id ??
      (modal.item?.account_id ? String(modal.item.account_id) : ""),
  );
  const [transactionCategory, setTransactionCategory] = useState(
    modal.item?._category_mode ??
      (modal.item?.category_id
        ? String(modal.item.category_id)
        : modal.item?.manual_category_lock ||
            modal.item?.category_source === "manual"
          ? ""
          : "automatic"),
  );
  const [categoryTouched, setCategoryTouched] = useState(
    modal.item?._category_touched || false,
  );
  const retainedTransactionAccount =
    modal.item?.account_id &&
    !accounts.some((account) => account.id === modal.item.account_id)
      ? {
          id: modal.item.account_id,
          name: modal.item.account_name || "Existing account",
          kind: modal.item.account_kind,
          currency: modal.item.currency || "USD",
          active: modal.item.account_active,
        }
      : null;
  const selectedTransactionAccount =
    accounts.find((account) => account.id === Number(transactionAccount)) ||
    (retainedTransactionAccount?.id === Number(transactionAccount)
      ? retainedTransactionAccount
      : null);
  const transactionCurrency =
    selectedTransactionAccount?.currency ||
    (transactionAccount === String(modal.item?.account_id)
      ? modal.item?.currency
      : "USD") ||
    "USD";
  const itemCategories = categories
    .filter(
      (category) =>
        category.active !== false ||
        (modal.item?.id && category.id === modal.item.budget_category_id),
    )
    .filter((category) => !category.managed);
  const currentCategory = categories.find(
    (category) => category.id === modal.item?.budget_category_id,
  );
  const selectedCategory = itemCategories.some(
    (category) => category.id === modal.item?.budget_category_id,
  )
    ? modal.item.budget_category_id
    : itemCategories[0]?.id || "";
  function createRule(event) {
    const values = Object.fromEntries(new FormData(event.currentTarget.form));
    const draft = {
      description: values.description,
      amount: values.amount,
      direction: values.direction,
      date: values.date,
      account_id: values.account_id,
      currency: transactionCurrency,
    };
    onCreateRule({
      ...modal.item,
      description: values.description,
      amount_cents:
        cents(values.amount) * (values.direction === "income" ? 1 : -1),
      date: values.date,
      account_id: values.account_id ? Number(values.account_id) : null,
      account_name: values.account_name,
      currency: transactionCurrency,
      category_id:
        transactionCategory && transactionCategory !== "automatic"
          ? Number(transactionCategory)
          : null,
      _category_mode: transactionCategory,
      _category_touched: categoryTouched,
      _draft: draft,
      _return_item: {
        ...modal.item,
        _draft: draft,
        _category_mode: transactionCategory,
        _category_touched: categoryTouched,
      },
    });
  }
  async function useRules() {
    try {
      const result = await onUseRules(modal.item);
      setTransactionCategory(
        result.category_id ? String(result.category_id) : "automatic",
      );
      setCategoryTouched(false);
    } catch {}
  }
  return (
    <Modal
      title={
        {
          item: modal.item?.id ? "Edit item" : "Add item",
          bill: modal.item ? "Edit a bill" : "One less thing to remember",
          transaction: modal.item?.id
            ? "Edit transaction"
            : "Record a little moment",
          account: modal.item ? "Edit your account" : "Bring an account home",
          simplefin: "Connect SimpleFIN",
          member: "Welcome someone home",
          copy: "Bring a good plan along",
          delete:
            modal.item?.kind === "account"
              ? "Archive this account?"
              : "Remove this item?",
        }[modal.type]
      }
      description={
        {
          item: "Choose its category and planned amount.",
          bill: "A due date, an amount, and a little peace of mind.",
          transaction: "Add the details and give it a purpose.",
          account: "Add a balance you’d like to keep in view.",
          simplefin:
            "Paste the setup token from your SimpleFIN Bridge account.",
          member:
            "Members share the household and get their own private budget.",
          copy: "Copy your expense plan and undated monthly income. Scheduled paydays are calculated for the new month; dated one-time income is not copied. Income already entered for the new month stays as it is.",
          delete:
            modal.item?.kind === "account"
              ? `“${modal.item?.name}” will be archived. Its balance history and imported transactions are kept, and future imports for this account stay hidden. Future unpaid debt reminders stop; paid history and earlier unpaid debt are kept.`
              : modal.item?.kind === "item"
                ? `“${modal.item?.name || "This item"}” will be removed from this month’s plan. Linked transactions are kept. Reminders can continue while other copies of this item remain; remove its due schedule first if you want to stop future reminders.`
                : modal.item?.kind === "bill" &&
                    modal.item?.recurrence === "monthly"
                  ? `This “${modal.item?.name}” bill will be removed and future unpaid reminders canceled. Other past or paid occurrences will be kept.`
                  : `“${modal.item?.name || "this item"}” will be removed from this budget.`,
        }[modal.type]
      }
      onClose={() => !busy && onClose()}
    >
      {modal.type === "delete" ? (
        <>
          <p className="muted">
            {modal.item?.kind === "account"
              ? "Archived accounts stay part of recorded history."
              : "This action cannot be undone."}
          </p>
          {formError && (
            <p className="inline-error" role="alert">
              {formError}
            </p>
          )}
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => onClose()}>
              Keep it
            </Button>
            <Button
              variant="danger"
              busy={busy}
              icon={modal.item?.kind === "account" ? Archive : Trash2}
              onClick={confirmDelete}
            >
              {modal.item?.kind === "account"
                ? "Archive account"
                : "Remove item"}
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={save}>
          {modal.type === "item" && (
            <>
              <Field label="Item name">
                <input
                  name="name"
                  required
                  maxLength={120}
                  defaultValue={modal.item?.name || ""}
                  placeholder="Groceries, weekend adventures…"
                />
              </Field>
              <div className="form-grid">
                <Field
                  label="Category"
                  help={
                    currentCategory?.active === false && modal.item?.id
                      ? "This category is archived. Keep the item here or move it to an active category."
                      : !itemCategories.length
                        ? "Add or reactivate a category before adding an item."
                        : undefined
                  }
                >
                  <select
                    name="budget_category_id"
                    required
                    defaultValue={selectedCategory}
                  >
                    {!itemCategories.length && (
                      <option value="">No active categories</option>
                    )}
                    {itemCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                        {category.active === false ? " (archived)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Planned amount">
                  <div className="money-input">
                    <span>$</span>
                    <input
                      name="amount"
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={
                        modal.item?.planned_cents !== undefined
                          ? (modal.item.planned_cents / 100).toFixed(2)
                          : ""
                      }
                      placeholder="0.00"
                    />
                  </div>
                </Field>
              </div>
            </>
          )}
          {modal.type === "bill" && (
            <>
              <Field label="Bill name">
                <input
                  required
                  name="name"
                  placeholder="Electricity, mortgage, internet…"
                  defaultValue={modal.item?.name || ""}
                />
              </Field>
              <div className="form-grid">
                <Field label="Amount">
                  <div className="money-input">
                    <span>$</span>
                    <input
                      name="amount"
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      defaultValue={
                        modal.item?.amount_cents !== undefined
                          ? (modal.item.amount_cents / 100).toFixed(2)
                          : ""
                      }
                    />
                  </div>
                </Field>
                <Field label="Due date">
                  <input
                    name="due_date"
                    required
                    type="date"
                    defaultValue={modal.item?.due_date || today(user.timezone)}
                  />
                </Field>
              </div>
              <Field
                label="Repeats"
                help={
                  modal.item?.recurrence === "monthly"
                    ? "Changes apply to future unpaid occurrences. Paid history stays as it is."
                    : undefined
                }
              >
                <select
                  name="recurrence"
                  defaultValue={modal.item?.recurrence || "monthly"}
                >
                  <option value="monthly">Every month</option>
                  <option value="none">One time</option>
                </select>
              </Field>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  name="autopay"
                  defaultChecked={modal.item?.autopay || false}
                />
                <span>Paid automatically (still needs confirmation)</span>
              </label>
            </>
          )}
          {modal.type === "transaction" && (
            <>
              <Field label="Description">
                <input
                  required
                  name="description"
                  placeholder="Where did it go, or come from?"
                  defaultValue={
                    modal.item?._draft?.description ??
                    modal.item?.description ??
                    ""
                  }
                />
              </Field>
              <div className="form-grid">
                <Field label={`Amount (${transactionCurrency})`}>
                  <div className="money-input">
                    <span>
                      {transactionCurrency === "USD"
                        ? "$"
                        : transactionCurrency}
                    </span>
                    <input
                      key={transactionCurrency}
                      name="amount"
                      required
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      defaultValue={
                        modal.item?._draft?.amount !== undefined &&
                        transactionCurrency ===
                          (modal.item._draft.currency ||
                            modal.item.currency ||
                            "USD")
                          ? modal.item._draft.amount
                          : modal.item?.amount_cents !== undefined &&
                              transactionCurrency ===
                                (modal.item.currency || "USD")
                            ? (Math.abs(modal.item.amount_cents) / 100).toFixed(
                                2,
                              )
                            : ""
                      }
                    />
                  </div>
                </Field>
                <Field label="Direction">
                  <select
                    name="direction"
                    defaultValue={
                      modal.item?._draft?.direction ??
                      (modal.item?.amount_cents > 0 ? "income" : "expense")
                    }
                  >
                    <option value="expense">Money out</option>
                    <option value="income">Money in</option>
                  </select>
                </Field>
              </div>
              <div className="form-grid">
                <Field label="Date">
                  <input
                    type="date"
                    required
                    name="date"
                    defaultValue={
                      modal.item?._draft?.date ??
                      modal.item?.date ??
                      today(user.timezone)
                    }
                  />
                </Field>
                <Field label="Account">
                  <select
                    name="account_id"
                    value={transactionAccount}
                    onChange={(event) =>
                      setTransactionAccount(event.target.value)
                    }
                  >
                    <option value="">Manual entry</option>
                    {retainedTransactionAccount && (
                      <option value={retainedTransactionAccount.id}>
                        {retainedTransactionAccount.name} ·{" "}
                        {retainedTransactionAccount.active === false
                          ? "Archived account"
                          : "Existing account"}{" "}
                        · {retainedTransactionAccount.currency}
                      </option>
                    )}
                    {accounts
                      .filter(
                        (account) =>
                          account.id === modal.item?.account_id ||
                          (account.active !== false &&
                            (account.currency || "USD") === "USD" &&
                            ["checking", "savings", "credit"].includes(
                              account.kind,
                            )),
                      )
                      .map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                          {account.institution
                            ? ` · ${account.institution}`
                            : ""}{" "}
                          · {account.kind}
                          {account.currency !== "USD"
                            ? ` · ${account.currency}`
                            : ""}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
              <input
                type="hidden"
                name="account_name"
                value={
                  selectedTransactionAccount?.name ||
                  (!transactionAccount && !modal.item?.account_id
                    ? modal.item?.account_name || "Manual entry"
                    : "Manual entry")
                }
              />
              {transactionCurrency !== "USD" && (
                <p className="muted small">
                  This bank record stays in {transactionCurrency}. No currency
                  conversion is applied.
                </p>
              )}
              <Field
                label="Purpose"
                help="Manual choices, including Uncategorized, are protected from rules."
              >
                <select
                  name="category_id"
                  value={transactionCategory}
                  onChange={(event) => {
                    setTransactionCategory(event.target.value);
                    setCategoryTouched(true);
                  }}
                >
                  {(!modal.item?.id ||
                    (!modal.item?.category_id &&
                      !modal.item?.manual_category_lock)) && (
                    <option value="automatic">Use rules automatically</option>
                  )}
                  <option value="">Uncategorized (manual)</option>
                  {groups.map((g) => (
                    <optgroup label={g.name} key={g.name}>
                      {g.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>
              <input
                type="hidden"
                name="category_touched"
                value={String(categoryTouched)}
              />
              {modal.item?.manual_category_lock && !modal.item?.category_id && (
                <div className="transaction-manual-choice">
                  <p>
                    Kept uncategorized by a manual choice. Rules use the saved
                    transaction details.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={useRules}
                    disabled={busy}
                  >
                    Use rules instead
                  </Button>
                </div>
              )}
              {onCreateRule && (
                <Button
                  type="button"
                  variant="secondary"
                  icon={SlidersHorizontal}
                  onClick={createRule}
                  disabled={busy}
                  className="transaction-create-rule"
                >
                  Create rule from this transaction
                </Button>
              )}
            </>
          )}
          {modal.type === "simplefin" && (
            <>
              <Field
                label="Setup token"
                help="Create a connection at SimpleFIN Bridge, then copy its setup token here."
              >
                <textarea
                  name="setup_token"
                  required
                  rows={4}
                  placeholder="Paste your setup token"
                  autoComplete="off"
                  spellCheck="false"
                />
              </Field>
              <a
                className="external-link"
                href="https://beta-bridge.simplefin.org/"
                target="_blank"
                rel="noreferrer"
              >
                Open SimpleFIN Bridge
                <ExternalLink size={14} />
              </a>
              <p className="muted small">
                Accounts imported into{" "}
                {scope === "personal"
                  ? "your personal budget"
                  : "the household"}{" "}
                are visible to{" "}
                {scope === "personal" ? "you only" : "household members"}. Set
                the connection’s scope with the budget switch before connecting.
              </p>
            </>
          )}
          {modal.type === "member" && (
            <>
              <Field label="Name">
                <input
                  required
                  name="display_name"
                  placeholder="Their name"
                  autoComplete="off"
                />
              </Field>
              <Field label="Username">
                <input
                  required
                  name="username"
                  placeholder="A username for signing in"
                  autoComplete="off"
                />
              </Field>
              <Field
                label="Initial password"
                help="Use at least 10 characters."
              >
                <input
                  required
                  name="password"
                  type="password"
                  minLength={10}
                  autoComplete="new-password"
                />
              </Field>
            </>
          )}
          {modal.type === "copy" && (
            <Field label="Month to copy">
              <input
                required
                type="month"
                name="from_month"
                defaultValue={stepMonth(month, -1)}
                max={stepMonth(month, -1)}
              />
            </Field>
          )}
          {formError && (
            <p className="inline-error" role="alert">
              <AlertCircle size={16} />
              {formError}
            </p>
          )}
          <div className="modal-actions">
            <Button variant="secondary" type="button" onClick={() => onClose()}>
              Cancel
            </Button>
            <Button
              type="submit"
              busy={busy}
              disabled={modal.type === "item" && !itemCategories.length}
              icon={modal.type === "simplefin" ? Link2 : Check}
            >
              {modal.type === "simplefin"
                ? "Connect accounts"
                : modal.type === "copy"
                  ? "Copy budget"
                  : modal.type === "member"
                    ? "Add member"
                    : modal.type === "transaction" && !modal.item?.id
                      ? "Add transaction"
                      : "Save changes"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
