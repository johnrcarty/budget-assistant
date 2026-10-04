import { Check, Trash2, AlertCircle, Link2, ExternalLink } from "lucide-react";
import { Button, Field, Modal } from "./ui.jsx";
import { today, stepMonth } from "../lib/format.js";
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
  onClose,
}) {
  const itemCategories = categories.filter(
    (category) =>
      category.active !== false ||
      (modal.item?.id && category.id === modal.item.budget_category_id),
  );
  const currentCategory = categories.find(
    (category) => category.id === modal.item?.budget_category_id,
  );
  const selectedCategory = itemCategories.some(
    (category) => category.id === modal.item?.budget_category_id,
  )
    ? modal.item.budget_category_id
    : itemCategories[0]?.id || "";
  return (
    <Modal
      title={
        {
          item: modal.item?.id ? "Edit item" : "Add item",
          bill: modal.item ? "Edit a bill" : "One less thing to remember",
          transaction: modal.item
            ? "Edit transaction"
            : "Record a little moment",
          account: modal.item ? "Edit your account" : "Bring an account home",
          simplefin: "Connect SimpleFIN",
          member: "Welcome someone home",
          copy: "Bring a good plan along",
          delete: "Remove this item?",
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
            modal.item?.kind === "item"
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
          <p className="muted">This action cannot be undone.</p>
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
              icon={Trash2}
              onClick={confirmDelete}
            >
              Remove item
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
                  defaultValue={modal.item?.description || ""}
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
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      defaultValue={
                        modal.item?.amount_cents !== undefined
                          ? (Math.abs(modal.item.amount_cents) / 100).toFixed(2)
                          : ""
                      }
                    />
                  </div>
                </Field>
                <Field label="Direction">
                  <select
                    name="direction"
                    defaultValue={
                      modal.item?.amount_cents > 0 ? "income" : "expense"
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
                    defaultValue={modal.item?.date || today(user.timezone)}
                  />
                </Field>
                <Field label="Account">
                  <input
                    name="account_name"
                    defaultValue={modal.item?.account_name || ""}
                    list="account-names"
                    placeholder="Cash or account name"
                  />
                  <datalist id="account-names">
                    {accounts.map((a) => (
                      <option key={a.id} value={a.name} />
                    ))}
                  </datalist>
                </Field>
              </div>
              <Field label="Purpose">
                <select
                  name="category_id"
                  defaultValue={modal.item?.category_id || ""}
                >
                  <option value="">Uncategorized</option>
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
            </>
          )}
          {modal.type === "account" && (
            <>
              <Field label="Account name">
                <input
                  required
                  name="name"
                  placeholder="Household checking"
                  defaultValue={modal.item?.name || ""}
                />
              </Field>
              <div className="form-grid">
                <Field label="Institution">
                  <input
                    name="institution"
                    placeholder="Your bank"
                    defaultValue={modal.item?.institution || ""}
                  />
                </Field>
                <Field label="Type">
                  <select
                    name="kind"
                    defaultValue={modal.item?.kind || "checking"}
                  >
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                    <option value="credit">Credit card</option>
                    <option value="investment">Investment</option>
                    <option value="loan">Loan</option>
                    <option value="property">Property</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
              </div>
              <Field
                label="Current balance"
                help="Credit and loan balances are counted as money owed. Imported balances refresh on sync."
              >
                <div className="money-input">
                  <span>$</span>
                  <input
                    required
                    type="number"
                    step="0.01"
                    name="amount"
                    placeholder="0.00"
                    defaultValue={
                      modal.item?.balance_cents !== undefined
                        ? (modal.item.balance_cents / 100).toFixed(2)
                        : ""
                    }
                  />
                </div>
              </Field>
              <Field label="Currency">
                <input
                  name="currency"
                  pattern="[A-Z]{3}"
                  maxLength={3}
                  required
                  defaultValue={modal.item?.currency || "USD"}
                />
              </Field>
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
                    : "Save changes"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
