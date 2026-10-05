import { useState } from "react";
import { AlertCircle, Check } from "lucide-react";
import { Button, Field, Modal } from "./ui.jsx";

export default function AccountDialog({
  account,
  busy,
  error,
  onSave,
  onClose,
}) {
  const [kind, setKind] = useState(account?.kind || "checking");
  const [currency, setCurrency] = useState(account?.currency || "USD");
  const [balance, setBalance] = useState(
    account?.balance_cents !== undefined
      ? (
          (["loan", "credit"].includes(account.kind)
            ? Math.abs(account.balance_cents)
            : account.balance_cents) / 100
        ).toFixed(2)
      : "",
  );
  const [originalAmount, setOriginalAmount] = useState(
    account?.original_balance_cents != null
      ? (account.original_balance_cents / 100).toFixed(2)
      : "",
  );
  const debt = ["loan", "credit"].includes(kind);
  return (
    <Modal
      title={account ? "Edit account" : "Add account"}
      description="Balances and debt terms stay with this account."
      onClose={() => !busy && onClose()}
    >
      <form onSubmit={onSave} className="account-form">
        <fieldset disabled={busy}>
          <Field label="Account name">
            <input
              required
              name="name"
              maxLength={120}
              defaultValue={account?.name || ""}
              placeholder="Household checking"
            />
          </Field>
          <div className="form-grid">
            <Field label="Institution">
              <input
                name="institution"
                maxLength={120}
                defaultValue={account?.institution || ""}
                placeholder="Your bank"
              />
            </Field>
            <Field label="Type">
              <select
                name="kind"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value);
                  if (
                    ["loan", "credit"].includes(event.target.value) &&
                    Number(balance) < 0
                  )
                    setBalance(String(Math.abs(Number(balance))));
                }}
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
          <div className="form-grid">
            <Field
              label={debt ? "Current amount owed" : "Current balance"}
              help={
                account?.source === "simplefin"
                  ? "Connected balances refresh on sync."
                  : debt
                    ? "Enter the amount still owed as a positive number."
                    : undefined
              }
            >
              <div className="money-input">
                <span>{currency}</span>
                <input
                  required
                  type="number"
                  step="0.01"
                  name="amount"
                  min={debt ? "0" : undefined}
                  value={balance}
                  onChange={(event) => setBalance(event.target.value)}
                  placeholder="0.00"
                />
              </div>
            </Field>
            <Field label="Currency">
              <input
                name="currency"
                pattern="[A-Z]{3}"
                maxLength={3}
                required
                value={currency}
                onChange={(event) => {
                  setCurrency(event.target.value.toUpperCase());
                  setBalance("");
                  setOriginalAmount("");
                }}
              />
            </Field>
          </div>
          {account && currency !== account.currency && (
            <p className="account-form-note">
              Enter the balance in {currency}. Leaving the original balance
              blank clears its previous currency amount.
            </p>
          )}
          {account && ["loan", "credit"].includes(account.kind) && !debt && (
            <p className="account-form-note">
              Changing to this type clears the optional debt terms. Stop its
              payment schedule first if one is active.
            </p>
          )}
          {debt && (
            <section
              className="account-debt-fields"
              aria-labelledby="account-debt-terms"
            >
              <h3 id="account-debt-terms">
                Debt terms <span>Optional</span>
              </h3>
              <div className="form-grid">
                <Field label="Original balance">
                  <div className="money-input">
                    <span>{currency}</span>
                    <input
                      name="original_amount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={originalAmount}
                      onChange={(event) =>
                        setOriginalAmount(event.target.value)
                      }
                      placeholder="0.00"
                    />
                  </div>
                </Field>
                <Field label="APR">
                  <div className="money-input">
                    <input
                      name="apr"
                      type="number"
                      min="0"
                      max="1000"
                      step="0.01"
                      defaultValue={
                        account?.apr_basis_points != null
                          ? (account.apr_basis_points / 100).toFixed(2)
                          : ""
                      }
                      placeholder="0.00"
                    />
                    <span>%</span>
                  </div>
                </Field>
              </div>
              <Field label="Debt type">
                <select
                  name="debt_type"
                  defaultValue={
                    account?.debt_type ||
                    (kind === "credit" ? "credit_card" : "")
                  }
                >
                  <option value="">Choose a type</option>
                  <option value="mortgage">Mortgage</option>
                  <option value="auto">Auto</option>
                  <option value="student">Student loan</option>
                  <option value="personal">Personal loan</option>
                  <option value="credit_card">Credit card</option>
                  <option value="line_of_credit">Line of credit</option>
                  <option value="other">Other debt</option>
                </select>
              </Field>
              <div className="form-grid">
                <Field label="Opened date">
                  <input
                    name="opened_date"
                    type="date"
                    defaultValue={account?.opened_date || ""}
                  />
                </Field>
                <Field label="Term in months">
                  <input
                    name="term_months"
                    type="number"
                    min="1"
                    max="1200"
                    step="1"
                    defaultValue={account?.term_months || ""}
                    placeholder="For example, 60"
                  />
                </Field>
              </div>
              <Field label="Notes">
                <textarea
                  name="notes"
                  rows={3}
                  maxLength={2000}
                  defaultValue={account?.notes || ""}
                  placeholder="Rate changes, lender details, or reminders"
                />
              </Field>
              <p className="account-form-note">
                Set dated payments from this account’s detail view after saving.
              </p>
            </section>
          )}
        </fieldset>
        {error && (
          <p className="inline-error" role="alert">
            <AlertCircle size={16} />
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" icon={Check} busy={busy}>
            Save account
          </Button>
        </div>
      </form>
    </Modal>
  );
}
