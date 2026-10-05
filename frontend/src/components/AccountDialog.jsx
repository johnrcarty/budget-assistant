import { useState } from "react";
import { AlertCircle, Check } from "lucide-react";
import { Button, Field, Modal } from "./ui.jsx";

export default function AccountDialog({
  account,
  studentLoanGroups = [],
  busy,
  error,
  onSave,
  onClose,
}) {
  const [kind, setKind] = useState(account?.kind || "checking");
  const [currency, setCurrency] = useState(account?.currency || "USD");
  const [debtType, setDebtType] = useState(account?.debt_type || (account?.kind === "credit" ? "credit_card" : ""));
  const [loanGroup, setLoanGroup] = useState(account?.student_loan_group_id || "");
  const [interest, setInterest] = useState(account?.accrued_interest_cents == null ? "" : (account.accrued_interest_cents / 100).toFixed(2));
  const [interestDate, setInterestDate] = useState(account?.accrued_interest_as_of || "");
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
      title={account?.id ? "Edit account" : "Add account"}
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
                <option value="vehicle">Vehicle</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </div>
          <div className="form-grid">
            <Field
              label={
                debt
                  ? "Current amount owed"
                  : ["property", "vehicle"].includes(kind)
                    ? "Current asset value"
                    : "Current balance"
              }
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
                  setInterest("");
                  setInterestDate("");
                  if (!account?.id) setLoanGroup("");
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
                  value={debtType}
                  onChange={(event) => setDebtType(event.target.value)}
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
              {kind === "loan" && debtType === "student" && !account?.id && (
                <Field label="Student loan group" help="Optional. The group controls whether this loan or its servicer total counts in net worth.">
                  <select name="student_loan_group_id" value={loanGroup} onChange={(event) => setLoanGroup(event.target.value)}>
                    <option value="">Keep as an individual account</option>
                    {studentLoanGroups.filter((group) => group.active !== false && group.currency === currency).map((group) => (
                      <option key={group.id} value={group.id}>{group.name} · {group.borrower} · {group.servicer}</option>
                    ))}
                  </select>
                </Field>
              )}
              {kind === "loan" && debtType === "student" && (
                <div className="form-grid">
                  <Field label="Reported accrued interest" help="Optional. Tracked separately and never added to the amount owed.">
                    <div className="money-input">
                      <span>{currency}</span>
                      <input name="accrued_interest" type="number" min="0" step="0.01" value={interest} onChange={(event) => setInterest(event.target.value)} placeholder="Not entered" />
                    </div>
                  </Field>
                  <Field label="Interest as of">
                    <input name="accrued_interest_as_of" type="date" value={interestDate} onChange={(event) => setInterestDate(event.target.value)} />
                  </Field>
                </div>
              )}
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
                After saving, use account details to set payments or link a
                property, vehicle, or other asset.
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
