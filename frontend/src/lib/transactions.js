import { cents } from "./format.js";

// Treatment and signed bank amount are independent. Only an explicit amount
// change should create a bank-feed override.
export function transactionDetailsBody(
  values,
  transaction = null,
  baseline = transaction,
) {
  if (values.transaction_type === "income" && values.direction !== "income")
    throw new Error(
      "Choose Money in before saving this transaction as income.",
    );
  const body = {
    description: values.description,
    amount_cents:
      cents(values.amount) * (values.direction === "income" ? 1 : -1),
    date: values.date,
    account_name: values.account_name || "Manual entry",
  };
  if (
    transaction?.id &&
    body.amount_cents === baseline?.amount_cents &&
    (values.currency || "USD") === (baseline?.currency || "USD")
  )
    delete body.amount_cents;
  if (transaction?.id && body.description === baseline?.description)
    delete body.description;
  if (transaction?.id && body.date === baseline?.date) delete body.date;
  if (
    values.role_touched === "true" ||
    (!transaction?.id && values.transaction_type === "transfer")
  )
    body.provider_role_override =
      values.transaction_type === "transfer" ? "bank_transfer" : "ordinary";
  if (
    values.category_id !== "automatic" &&
    (!transaction?.id || values.category_touched === "true")
  )
    body.category_id = values.category_id ? Number(values.category_id) : null;
  const accountId = values.account_id ? Number(values.account_id) : null;
  if (accountId !== null && !Number.isFinite(accountId))
    throw new Error(
      "Choose an available account or Manual entry before saving.",
    );
  if (
    !transaction?.id ||
    values.account_touched === "true" ||
    accountId !== baseline?.account_id
  )
    body.account_id = accountId;
  if (
    transaction?.id &&
    !Object.hasOwn(body, "account_id") &&
    body.account_name === (baseline?.account_name || "Manual entry")
  )
    delete body.account_name;
  return body;
}

export function incomeCreationRequest(previous, body, context) {
  const fingerprint = JSON.stringify({ context, body });
  if (previous?.fingerprint === fingerprint) return previous;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return {
    fingerprint,
    key: `income-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
  };
}
