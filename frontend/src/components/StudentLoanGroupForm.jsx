import { useState } from "react";
import { Check } from "lucide-react";
import { money } from "../lib/format.js";
import { Button, Field } from "./ui.jsx";

export default function StudentLoanGroupForm({ group, groups = [], accounts, busy, onSave, onCancel }) {
  const [currency, setCurrency] = useState(group?.currency || "USD");
  const [mode, setMode] = useState(group?.valuation_mode || "individual_loans");
  const [reported, setReported] = useState(group?.reported_account_id || "");
  const [children, setChildren] = useState((group?.children || []).map((account) => account.id));
  const members = group?.children || [];
  const occupied = new Set(groups.filter((entry) => entry.active !== false && entry.id !== group?.id).flatMap((entry) => [...(entry.children || []).map((account) => account.id), entry.reported_account_id].filter(Boolean)));
  const currencyLocked = !!group?.id && (members.length > 0 || !!group?.reported_account_id);
  const available = accounts.filter((account) => account.active !== false && account.kind === "loan" && account.debt_type === "student" && (account.currency || "USD") === currency && !occupied.has(account.id) && (!account.student_loan_group_id || account.student_loan_group_id === group?.id));
  const retained = [...members, ...(group?.reported_account ? [group.reported_account] : [])].filter((account) => (account.currency || "USD") === currency && !available.some((candidate) => candidate.id === account.id));
  const choices = [...available, ...retained].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id - b.id);
  const currencies = [...new Set(["USD", group?.currency, ...accounts.filter((account) => account.kind === "loan" && account.debt_type === "student").map((account) => account.currency || "USD")].filter(Boolean))].sort();
  async function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await onSave({
      name: values.name.trim(),
      borrower: values.borrower.trim(),
      servicer: values.servicer.trim(),
      currency,
      valuation_mode: mode,
      reported_account_id: reported ? Number(reported) : null,
      child_account_ids: children,
    });
  }
  return (
    <form className="student-group-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <Field label="Group name">
          <input name="name" maxLength={120} required defaultValue={group?.name || ""} placeholder="Student loans" />
        </Field>
        <div className="form-grid">
          <Field label="Borrower">
            <input name="borrower" maxLength={80} required defaultValue={group?.borrower || ""} placeholder="Borrower name" />
          </Field>
          <Field label="Servicer">
            <input name="servicer" maxLength={120} required defaultValue={group?.servicer || ""} placeholder="Loan servicer" />
          </Field>
        </div>
        <Field label="Currency">
          <select value={currency} disabled={busy || currencyLocked} onChange={(event) => {setCurrency(event.target.value);setChildren([]);setReported("");}}>
            {currencies.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          {currencyLocked && <small>Remove linked accounts and save before changing this group's currency.</small>}
        </Field>
        <Field label="Balance counted in net worth">
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="individual_loans">Sum of individual loans</option>
            <option value="servicer_total">Servicer's reported total</option>
          </select>
          <small>One balance source counts. The other records stay available as a breakdown.</small>
          {group?.id && <small>When changing the balance source or servicer total, keep all currently counted accounts linked for the first save. Detach excluded references after saving the switch.</small>}
        </Field>
        <Field label={mode === "servicer_total" ? "Reported total account" : "Reported total account · optional"}>
          <select value={reported} required={mode === "servicer_total"} onChange={(event) => {const value=event.target.value;setReported(value);setChildren((ids) => ids.filter((id) => id !== Number(value)));}}>
            <option value="">{mode === "servicer_total" ? "Choose the servicer total" : "No separate total account"}</option>
            {choices.map((account) => <option key={account.id} value={account.id}>{account.name} · {money(Math.abs(account.balance_cents), account.currency || currency)}{account.active === false ? " · Archived" : ""}</option>)}
          </select>
          {mode === "individual_loans" && reported && <small>This total is retained and excluded from net worth while individual loans count.</small>}
        </Field>
        <fieldset className="student-group-members">
          <legend>Individual loans</legend>
          {!choices.filter((account) => account.id !== Number(reported)).length && <p className="drawer-muted">No eligible loans yet. Save the group, then add a loan.</p>}
          {choices.filter((account) => account.id !== Number(reported)).map((account) => (
            <label key={account.id} className="student-group-member">
              <input type="checkbox" checked={children.includes(account.id)} disabled={busy} onChange={(event) => setChildren((ids) => event.target.checked ? [...ids, account.id] : ids.filter((id) => id !== account.id))} />
              <span><strong>{account.name}</strong><small>{account.institution || "Student loan"}{account.active === false ? " · Archived" : ""}</small></span>
              <strong>{money(Math.abs(account.balance_cents), account.currency || currency)}</strong>
            </label>
          ))}
        </fieldset>
        <p className="drawer-muted">Borrower is a display label; this group keeps its current household or personal access. Loan payment schedules stay with each account. Removing a loan keeps its current net-worth setting.</p>
      </fieldset>
      <div className="drawer-form-actions">
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button type="submit" icon={Check} busy={busy}>Save group</Button>
      </div>
    </form>
  );
}
