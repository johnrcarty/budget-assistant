import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { api } from "../lib/api.js";
import { isCountedAccount } from "../lib/accounts.js";
import { Button } from "./ui.jsx";

export default function AccountValuation({account, group, scope, month, busy, locked = false, onBusyChange, onOpenGroup, onChanged, notify}) {
  const [override, setOverride] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const section = useRef(null);
  const mounted = useRef(true);
  const restore = useRef(false);
  const included = override ?? isCountedAccount(account);
  const setBusy = onBusyChange;
  const grouped = !!account.student_loan_group_id;
  useEffect(() => {setOverride(null);setError("");}, [account]);
  useEffect(() => {mounted.current=true;return () => {mounted.current=false;};}, []);
  useEffect(() => {
    if(busy || !section.current)return;
    if(confirming) {const panel=section.current.querySelector(".account-valuation-confirmation");if(!panel?.contains(document.activeElement))panel?.querySelector("button:not(:disabled)")?.focus();}
    else if(restore.current) {const target=section.current.querySelector(".account-valuation-change:not(:disabled)") || section.current.closest(".account-drawer")?.querySelector(".account-refresh-trigger:not(:disabled)");if(target){target.focus();restore.current=false;}}
  }, [confirming, busy, locked]);
  async function save() {
    if (busy || locked) return;
    setBusy(true);setError("");
    try {
      const result=await api(`accounts/${account.id}?scope=${scope}&month=${month}`,{method:"PATCH",body:{net_worth_included:!included}});
      if(!mounted.current)return;
      setOverride(result.net_worth_included);setConfirming(false);notify(result.net_worth_included ? "Account included in net worth." : "Account excluded from net worth.");
      await onChanged();
    } catch(failure){if(mounted.current)setError(failure.message);}
    finally{if(mounted.current)setBusy(false);}
  }
  return (
    <section ref={section} className="account-valuation-section">
      <div className="drawer-section-heading"><h3>Net worth</h3>{!grouped && account.active!==false && !confirming && <Button className="account-valuation-change" variant="ghost" disabled={busy || locked} onClick={()=>{restore.current=true;setConfirming(true);setError("");}}>{included ? "Exclude account" : "Include account"}</Button>}</div>
      <p className="drawer-muted">{account.active === false ? `Archived accounts are excluded from current net worth. Its retained inclusion setting is ${included ? "included" : "excluded"}.` : included ? "This account's balance counts in net worth." : "This account is retained but its balance does not count in net worth."}</p>
      {grouped && <p className="account-group-membership">{group ? <><strong>{group.name}</strong><span>{group.borrower} · {group.servicer}</span><Button variant="secondary" disabled={busy || locked} onClick={()=>onOpenGroup(group)}>Manage loan group</Button></> : "The student loan group controls this account's balance source."}</p>}
      {confirming && <div className="account-valuation-confirmation"><p>{included ? "Exclude this account's balance from debt and net-worth totals? Its account records, payments and balance history remain." : "Include this account's balance in debt and net-worth totals? Check that another servicer total does not already represent it. Its earlier history is retained."}</p><div className="drawer-form-actions"><Button variant="secondary" disabled={busy} onClick={()=>setConfirming(false)}>Cancel</Button><Button busy={busy} disabled={busy || locked} onClick={save}>{included ? "Exclude from net worth" : "Include in net worth"}</Button></div></div>}
      {error && <p className="inline-error" role="alert"><AlertCircle size={16}/>{error}</p>}
    </section>
  );
}
