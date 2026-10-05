import { useState } from "react";
import { Button, Field } from "./ui.jsx";
import { money, monthLabel } from "../lib/format.js";

export default function CategorizationRuleForm({
  rule,
  seed,
  categories,
  accounts,
  month,
  busy,
  onSave,
  onCancel,
}) {
  const availableCategories = categories.filter(
    (category) => category.active !== false && category.items.length > 0,
  );
  const availableItems = availableCategories.flatMap(
    (category) => category.items,
  );
  const initialTarget = rule
    ? rule.budget_item_id
      ? String(rule.budget_item_id)
      : "retained"
    : availableItems.some((item) => item.id === seed?.category_id)
      ? String(seed.category_id)
      : "";
  const [target, setTarget] = useState(initialTarget);
  const unavailableTarget =
    rule && !availableItems.some((item) => item.id === rule.budget_item_id);
  const eligibleAccounts = accounts.filter(
    (account) =>
      account.active !== false &&
      (account.currency || "USD") === "USD" &&
      ["checking", "savings", "credit"].includes(account.kind),
  );
  const retainedAccount =
    rule?.account_id &&
    !eligibleAccounts.some((account) => account.id === rule.account_id);

  function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const body = {
      name: values.name.trim(),
      merchant_text: values.merchant_text.trim(),
      match_type: values.match_type,
      direction: values.direction,
      active: values.active === "on",
    };
    if (!rule || values.account_id !== String(rule.account_id || ""))
      body.account_id = values.account_id ? Number(values.account_id) : null;
    if (!rule || target !== initialTarget) body.budget_item_id = Number(target);
    onSave(body);
  }

  return (
    <form className="item-drawer-form rule-form" onSubmit={submit}>
      <h3>{rule ? "Edit rule" : "Add rule"}</h3>
      {seed && (
        <p className="drawer-muted">
          Uses this draft’s description and purpose. Transaction edits are saved
          separately.
        </p>
      )}
      <fieldset disabled={busy}>
        <Field label="Rule name">
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={rule?.name || seed?.description?.slice(0, 80) || ""}
            placeholder="Weekly groceries"
          />
        </Field>
        <Field
          label="Merchant text"
          help="Matches ignore case and repeated spaces. Use the part of a description that stays the same."
        >
          <input
            name="merchant_text"
            required
            maxLength={200}
            defaultValue={
              rule?.merchant_text || seed?.description?.slice(0, 200) || ""
            }
            placeholder="A merchant or recurring description"
          />
        </Field>
        <div className="form-grid">
          <Field label="Match">
            <select
              name="match_type"
              defaultValue={rule?.match_type || "contains"}
            >
              <option value="contains">Contains this text</option>
              <option value="exact">Exact description</option>
            </select>
          </Field>
          <Field label="Direction">
            <select
              name="direction"
              defaultValue={
                rule?.direction ||
                (seed?._draft?.direction === "income" || seed?.amount_cents > 0
                  ? "inflow"
                  : "outflow")
              }
            >
              <option value="outflow">Money out</option>
              <option value="inflow">Money in</option>
              <option value="any">Either direction</option>
            </select>
          </Field>
        </div>
        <Field label="Account">
          <select name="account_id" defaultValue={rule?.account_id || ""}>
            <option value="">Any eligible account or manual entry</option>
            {retainedAccount && (
              <option value={rule.account_id}>
                {rule.account_name || "Existing account"} · Unavailable account
              </option>
            )}
            {eligibleAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
                {account.institution ? ` · ${account.institution}` : ""} ·{" "}
                {account.kind}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={`Budget item for ${monthLabel(month)}`}
          help="Future transactions use copies of this item in their own month. A missing or archived item stays unresolved; rules never create budget items."
        >
          <select
            required
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="" disabled>
              Choose a budget item
            </option>
            {unavailableTarget && (
              <option value={initialTarget}>
                {rule.target_group_name} · {rule.target_name} · Unavailable this
                month
              </option>
            )}
            {availableCategories.map((category) => (
              <optgroup key={category.id} label={category.name}>
                {category.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {money(item.planned_cents)} planned
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        {!availableItems.length && !rule && (
          <p className="drawer-muted">
            Add a budget item to this month before creating a rule.
          </p>
        )}
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="active"
            defaultChecked={rule?.active ?? true}
          />
          <span>Apply this rule automatically</span>
        </label>
        <div className="item-drawer-form-actions">
          <Button variant="secondary" type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" busy={busy} disabled={!target}>
            {rule ? "Save rule" : "Add rule"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
