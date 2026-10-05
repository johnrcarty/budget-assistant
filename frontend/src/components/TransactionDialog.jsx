import { useRef, useState } from "react";
import { Check, RefreshCw, SlidersHorizontal } from "lucide-react";
import { Button, Field, Modal } from "./ui.jsx";
import { cents, today } from "../lib/format.js";
import IncomeTransactionAssignment from "./IncomeTransactionAssignment.jsx";

export default function TransactionDialog({
  transaction,
  user,
  scope,
  month,
  income,
  groups,
  accounts,
  busy,
  error,
  onSave,
  onClose,
  onCreateRule,
  onUseRules,
  onResetTreatment,
  onIncomeSaved,
  onChanged,
}) {
  const item = transaction;
  const baseline = useRef(
    item?._details_baseline ||
      (item
        ? {
            ...item,
            account_id: item.account_unavailable
              ? "unavailable"
              : (item.account_id ?? null),
          }
        : null),
  );
  const currentRole =
    item?.transaction_role || item?.effective_provider_role || "ordinary";
  const [accountId, setAccountId] = useState(
    item?._draft?.account_id ??
      (item?.account_unavailable
        ? "unavailable"
        : item?.account_id
          ? String(item.account_id)
          : ""),
  );
  const [accountTouched, setAccountTouched] = useState(
    item?._draft?.account_touched === "true",
  );
  const [type, setType] = useState(
    item?._draft?.treatment ||
      (currentRole === "bank_transfer"
        ? "transfer"
        : item?.income_entry_id ||
            (item?.amount_cents > 0 && !item?.category_id)
          ? "income"
          : "expense"),
  );
  const [direction, setDirection] = useState(
    item?._draft?.direction || (item?.amount_cents > 0 ? "income" : "expense"),
  );
  const [roleTouched, setRoleTouched] = useState(item?._role_touched || false);
  const [category, setCategory] = useState(
    item?._category_mode ??
      (item?.category_id
        ? String(item.category_id)
        : item?.manual_category_lock || item?.category_source === "manual"
          ? ""
          : "automatic"),
  );
  const [categoryTouched, setCategoryTouched] = useState(
    item?._category_touched || false,
  );
  const [panelBusy, setPanelBusy] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [detailsDirty, setDetailsDirty] = useState(!!item?._draft);
  const locked = busy || panelBusy;
  const retained =
    item?.account_id &&
    !accounts.some((account) => account.id === item.account_id)
      ? {
          id: item.account_id,
          name: item.account_name || "Existing account",
          currency: item.currency || "USD",
          active: item.account_active,
          kind: item.account_kind,
        }
      : null;
  const selected =
    accounts.find((account) => account.id === Number(accountId)) ||
    (retained?.id === Number(accountId) ? retained : null);
  const currency =
    selected?.currency ||
    (accountId === String(item?.account_id) ||
    (item?.account_unavailable && accountId === "unavailable")
      ? item?.currency
      : "USD") ||
    "USD";
  function chooseType(value) {
    setType(value);
    setRoleTouched(true);
    if (value !== "expense") {
      setCategory("");
      setCategoryTouched(true);
    }
  }
  function createRule(event) {
    const values = Object.fromEntries(new FormData(event.currentTarget.form));
    const draft = { ...values, treatment: type, currency };
    onCreateRule({
      ...item,
      description: values.description,
      amount_cents: cents(values.amount) * (direction === "income" ? 1 : -1),
      date: values.date,
      account_id: accountId ? Number(accountId) : null,
      account_name: selected?.name || "Manual entry",
      currency,
      _draft: draft,
      _role_touched: roleTouched,
      _category_mode: category,
      _category_touched: categoryTouched,
      _return_item: {
        ...item,
        _details_baseline: baseline.current,
        _draft: draft,
        _role_touched: roleTouched,
        _category_mode: category,
        _category_touched: categoryTouched,
      },
    });
  }
  async function useRules() {
    try {
      const result = await onUseRules(item);
      setCategory(
        result.category_id ? String(result.category_id) : "automatic",
      );
      setCategoryTouched(false);
    } catch {}
  }
  return (
    <Modal
      title={item?.id ? "Edit transaction" : "Add transaction"}
      description="Keep the transaction details, income match and transfer treatment together."
      onClose={() => !locked && onClose()}
    >
      <form
        onChange={() => setDetailsDirty(true)}
        onSubmit={async (event) => {
          const values = Object.fromEntries(new FormData(event.currentTarget));
          const saved = await onSave(event, baseline.current);
          if (saved) {
            baseline.current = {
              description: values.description,
              date: values.date,
              account_id: values.account_id ? Number(values.account_id) : null,
              account_name: values.account_name || "Manual entry",
              currency: values.currency || "USD",
              amount_cents:
                cents(values.amount) * (values.direction === "income" ? 1 : -1),
            };
            setDetailsDirty(false);
            setCategoryTouched(false);
            setRoleTouched(false);
            setAccountTouched(false);
          }
        }}
      >
        <fieldset
          disabled={locked || refreshRequired}
          className="transaction-fields"
        >
          <Field label="Description">
            <input
              name="description"
              required
              maxLength={300}
              defaultValue={
                item?._draft?.description ?? item?.description ?? ""
              }
            />
          </Field>
          <div className="form-grid">
            <Field label="Type">
              <select
                name="transaction_type"
                value={type}
                onChange={(e) => chooseType(e.target.value)}
              >
                <option value="expense">Expense or refund</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer</option>
              </select>
            </Field>
            <Field label={`Amount (${currency})`}>
              <div className="money-input">
                <span>{currency === "USD" ? "$" : currency}</span>
                <input
                  key={currency}
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  defaultValue={
                    item?._draft?.amount !== undefined &&
                    currency ===
                      (item._draft.currency || item.currency || "USD")
                      ? item._draft.amount
                      : item?.amount_cents !== undefined &&
                          currency === (item.currency || "USD")
                        ? (Math.abs(item.amount_cents) / 100).toFixed(2)
                        : ""
                  }
                />
              </div>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Direction">
              <select
                name="direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
              >
                <option value="expense">Money out</option>
                <option value="income">
                  Money in{type === "expense" ? " · refund" : ""}
                </option>
              </select>
            </Field>
            <Field label="Date">
              <input
                name="date"
                type="date"
                required
                defaultValue={
                  item?._draft?.date || item?.date || today(user.timezone)
                }
              />
            </Field>
          </div>
          <Field label="Account">
            <select
              name="account_id"
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                setAccountTouched(true);
              }}
            >
              {item?.account_unavailable && (
                <option value="unavailable" disabled>
                  Unavailable account — choose an account
                </option>
              )}
              <option value="">Manual entry</option>
              {retained && (
                <option value={retained.id}>
                  {retained.name} ·{" "}
                  {retained.active === false ? "Archived" : "Existing"} ·{" "}
                  {retained.currency}
                </option>
              )}
              {accounts
                .filter(
                  (account) =>
                    account.id === item?.account_id ||
                    (account.active !== false &&
                      (account.currency || "USD") === "USD" &&
                      ["checking", "savings", "credit"].includes(account.kind)),
                )
                .map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name}
                    {account.institution
                      ? ` · ${account.institution}`
                      : ""} · {account.kind}
                    {account.currency !== "USD" ? ` · ${account.currency}` : ""}
                  </option>
                ))}
            </select>
          </Field>
          <input
            type="hidden"
            name="account_name"
            value={
              selected?.name ||
              (!accountId && !item?.account_id
                ? item?.account_name || "Manual entry"
                : "Manual entry")
            }
          />
          <input
            type="hidden"
            name="role_touched"
            value={String(roleTouched)}
          />
          <input type="hidden" name="currency" value={currency} />
          <input
            type="hidden"
            name="account_touched"
            value={String(accountTouched)}
          />
          {item?.account_unavailable && (
            <p className="inline-error">
              This account is unavailable. Choose an account or Manual entry and
              review the amount and currency before saving.
            </p>
          )}
          {currency !== "USD" && (
            <p className="muted small">
              This record stays in {currency}. No currency conversion is
              applied.
            </p>
          )}
          {type === "expense" ? (
            <Field
              label="Budget item"
              help="Manual assignments are protected from rules."
            >
              <select
                name="category_id"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setCategoryTouched(true);
                }}
              >
                {(!item?.id ||
                  (!item?.category_id && !item?.manual_category_lock)) && (
                  <option value="automatic">Use rules automatically</option>
                )}
                <option value="">Uncategorized (manual)</option>
                {groups.map((group) => (
                  <optgroup key={group.name} label={group.name}>
                    {group.items.map((budgetItem) => (
                      <option value={budgetItem.id} key={budgetItem.id}>
                        {budgetItem.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
          ) : (
            <input type="hidden" name="category_id" value="" />
          )}
          <input
            type="hidden"
            name="category_touched"
            value={String(categoryTouched)}
          />
          {type === "transfer" && (
            <p className="income-assignment-note">
              Transfers stay in your account records and are excluded from
              income and budget spending.
              {item?.category_id && roleTouched
                ? " Saving clears its budget item assignment."
                : ""}
              {item?.income_entry_id
                ? " Unlink the receipt below before saving it as a transfer."
                : ""}
            </p>
          )}
          {type === "income" && (
            <p className="income-assignment-note">
              Match this saved transaction to a planned payday below. The
              expected income and actual receipt are tracked separately.
              {direction !== "income"
                ? " Choose Money in above to save it as income. Changing its type preserves the recorded direction."
                : ""}
              {item?.category_id && categoryTouched
                ? " Saving clears its budget item assignment."
                : ""}
            </p>
          )}
          {item?.provider_handler && (
            <p className="transaction-handler-note">
              Bank handling:{" "}
              {item.provider_handler === "fidelity_core_v1"
                ? "Fidelity core sweep"
                : "Automatic transfer detection"}
              {item.provider_role_override ? " · manual treatment" : ""}.
            </p>
          )}
          {type === "expense" &&
            currentRole === "ordinary" &&
            !item?.income_entry_id && (
              <>
                {item?.manual_category_lock && !item?.category_id && (
                  <Button type="button" variant="secondary" onClick={useRules}>
                    Use rules instead
                  </Button>
                )}
                {onCreateRule && (
                  <Button
                    type="button"
                    variant="secondary"
                    icon={SlidersHorizontal}
                    onClick={createRule}
                    className="transaction-create-rule"
                  >
                    Create rule
                  </Button>
                )}
              </>
            )}
          {item?.id && item.provider_role_override != null && (
            <Button
              type="button"
              variant="ghost"
              icon={RefreshCw}
              onClick={async () => {
                try {
                  const result = await onResetTreatment(item);
                  setType(
                    result.transaction_role === "bank_transfer"
                      ? "transfer"
                      : result.income_entry_id ||
                          (result.amount_cents > 0 && !result.category_id)
                        ? "income"
                        : "expense",
                  );
                  setRoleTouched(false);
                } catch {}
              }}
            >
              Use bank treatment
            </Button>
          )}
        </fieldset>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={locked}
            onClick={onClose}
          >
            Close
          </Button>
          <Button
            type="submit"
            icon={Check}
            busy={busy}
            disabled={
              panelBusy ||
              refreshRequired ||
              accountId === "unavailable" ||
              (type === "income" && direction !== "income") ||
              (type === "transfer" && !!item?.income_entry_id)
            }
          >
            Save transaction
          </Button>
        </div>
      </form>
      {item?.id ? (
        <IncomeTransactionAssignment
          key={item.id}
          transaction={item}
          income={income}
          scope={scope}
          month={month}
          busy={busy}
          onBusyChange={setPanelBusy}
          onRefreshRequiredChange={setRefreshRequired}
          draftChanged={detailsDirty}
          onSaved={(result) => {
            if (result.income_entry_id) {
              setType("income");
              setCategory("");
              setCategoryTouched(false);
            }
            onIncomeSaved(result);
          }}
          onChanged={onChanged}
        />
      ) : (
        type === "income" && (
          <p className="income-assignment-note">
            Save the transaction, then match it to an existing payday or create
            an income item.
          </p>
        )
      )}
    </Modal>
  );
}
