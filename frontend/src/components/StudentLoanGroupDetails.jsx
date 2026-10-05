import { useEffect, useRef, useState } from "react";
import { AlertCircle, Archive, ArrowUpRight, Pencil, Plus, RefreshCw, X } from "lucide-react";
import { api } from "../lib/api.js";
import { money, prettyDate } from "../lib/format.js";
import { Button, IconButton } from "./ui.jsx";
import StudentLoanGroupForm from "./StudentLoanGroupForm.jsx";

export function StudentLoanMetrics({group}) {
  const currency = group.currency || "USD";
  const reports = (group.children || []).filter((account) => account.active !== false && account.accrued_interest_cents != null && !account.accrued_interest_stale);
  const dates = [...new Set(reports.map((account) => account.accrued_interest_as_of).filter(Boolean))].sort();
  const undated = reports.filter((account) => !account.accrued_interest_as_of).length;
  return (
    <>
      <dl className="student-group-metrics">
        <div><dt>Known weighted APR</dt><dd>{group.weighted_apr_basis_points == null ? "Not entered" : `${(group.weighted_apr_basis_points / 100).toFixed(2)}%`}</dd><small>{group.apr_complete ? "All outstanding loans have a rate" : `Rate known on ${money(group.apr_covered_balance_cents, currency)} of the loan breakdown`}</small></div>
        <div><dt>Reported accrued interest</dt><dd>{group.accrued_interest_cents == null ? "Not entered" : money(group.accrued_interest_cents, currency)}</dd><small>{group.interest_reported_count || 0} loan{group.interest_reported_count === 1 ? "" : "s"} reported{group.interest_complete ? " · Complete breakdown" : " · Partial coverage"}</small></div>
      </dl>
      <p className="drawer-muted">Reported interest is tracked separately and is never added to the amount owed. {dates.length ? `Reports dated ${prettyDate(dates[0])}, ${dates[0].slice(0,4)}${dates.length > 1 ? ` to ${prettyDate(dates.at(-1))}, ${dates.at(-1).slice(0,4)}` : ""}. ` : ""}{undated ? `${undated} report${undated === 1 ? " has" : "s have"} no date. ` : ""}{group.interest_stale_count ? `${group.interest_stale_count} stale report${group.interest_stale_count === 1 ? " is" : "s are"} excluded.` : ""}</p>
    </>
  );
}

export default function StudentLoanGroupDetails({group, groups, accounts, scope, month, onClose, onChanged, notify, onOpenAccount, onAddLoan}) {
  const dialog = useRef(null);
  const mounted = useRef(true);
  const restore = useRef(null);
  const [record, setRecord] = useState(group);
  const [editing, setEditing] = useState(!group.id);
  const [archiving, setArchiving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [archived, setArchived] = useState(false);
  const query = `scope=${scope}&month=${month}`;
  useEffect(() => {if (group.id) {setRecord(group);setRefreshFailed(false);}}, [group]);
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    mounted.current=true;
    dialog.current.showModal();
    document.body.style.overflow="hidden";
    return () => {mounted.current=false;dialog.current?.close();document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus();};
  }, []);
  useEffect(() => {
    if(busy || !dialog.current)return;
    const panel=editing ? dialog.current.querySelector(".student-group-form") : archiving ? dialog.current.querySelector(".student-group-archive") : null;
    if(panel && !panel.contains(document.activeElement)) {panel.querySelector("input:not(:disabled),select:not(:disabled),button:not(:disabled)")?.focus();return;}
    if(!panel && restore.current) {const target=dialog.current.querySelector(`${restore.current}:not(:disabled)`) || dialog.current.querySelector(".student-group-refresh:not(:disabled)");if(target){target.focus();restore.current=null;}}
  }, [editing, archiving, busy, refreshFailed]);
  async function refresh() {
    setBusy(true);
    try {const updated=await onChanged();if(!mounted.current)return;setRefreshFailed(updated===false);setError(updated===false ? "The group is saved. Refresh Accounts before making another change." : "");if(updated!==false && archived)onClose();}
    catch {if(mounted.current){setRefreshFailed(true);setError("The group is saved. Refresh Accounts before making another change.");}}
    finally {if(mounted.current)setBusy(false);}
  }
  async function save(body) {
    setBusy(true);setError("");
    try {
      const result=await api(`student-loan-groups${record.id ? `/${record.id}` : ""}?${query}`,{method:record.id ? "PUT" : "POST",body});
      if(!mounted.current)return;
      setRecord(result);setEditing(false);restore.current=".student-group-edit";
      notify("Student loan group saved.");
      try {
        const updated=await onChanged();
        if(updated===false && mounted.current){setRefreshFailed(true);setError("The group is saved. Refresh Accounts before making another change.");}
      } catch {if(mounted.current){setRefreshFailed(true);setError("The group is saved. Refresh Accounts before making another change.");}}
    } catch(failure){if(mounted.current)setError(failure.message);}
    finally{if(mounted.current)setBusy(false);}
  }
  async function archive() {
    setBusy(true);setError("");
    try {
      await api(`student-loan-groups/${record.id}?${query}`,{method:"DELETE"});
      notify("Group archived. Loan accounts and their net-worth settings are retained.");
      if(!mounted.current)return;
      setArchived(true);setRecord((current)=>({...current,active:false}));setArchiving(false);restore.current=".student-group-refresh";
      try {
        const updated=await onChanged();
        if(!mounted.current)return;
        if(updated!==false)onClose();else{setRefreshFailed(true);setError("The group was archived. Refresh Accounts to update the list; account net-worth settings were retained.");}
      }catch{if(mounted.current){setRefreshFailed(true);setError("The group was archived. Refresh Accounts to update the list; account net-worth settings were retained.");}}
    } catch(failure){if(mounted.current)setError(failure.message);}
    finally{if(mounted.current)setBusy(false);}
  }
  const children=record.children || [];
  const currency=record.currency || "USD";
  const linked = record.reported_account;
  function openAccount(account) {onOpenAccount(accounts.find((entry)=>entry.id===account.id) || account);}
  return (
    <dialog ref={dialog} className="item-drawer student-group-drawer" aria-labelledby="student-group-title" onCancel={(event)=>{event.preventDefault();if(!busy)onClose();}} onClick={(event)=>{if(event.target!==event.currentTarget || busy)return;const rect=dialog.current.getBoundingClientRect();if(event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom)onClose();}}>
      <div className="item-drawer-header">
        <div><p className="eyebrow">STUDENT LOANS</p><h2 id="student-group-title">{record.name || "Create a loan group"}</h2>{record.id && <span className="item-drawer-category">{record.borrower} · {record.servicer} · {currency}</span>}</div>
        <IconButton label="Close loan group" onClick={onClose} disabled={busy}><X size={21}/></IconButton>
      </div>
      <div className="item-drawer-content">
        {record.id && <>
          <section className="account-detail-balance"><span>Balance counted in net worth</span><strong>{money(record.balance_cents,currency)}</strong><p>{record.valuation_mode==="servicer_total" ? "Servicer's reported total" : "Sum of individual loans"}</p></section>
          {!record.breakdown_complete && <p className="student-group-notice"><AlertCircle size={16}/><span>Loan breakdown incomplete: {money(record.child_balance_cents,currency)} across {record.active_child_count ?? children.filter((account)=>account.active!==false).length} loans. The servicer total remains authoritative.</span></p>}
          <StudentLoanMetrics group={record}/>
          <section className="student-group-account-section">
            <div className="drawer-section-heading"><h3>Individual loans</h3><Button variant="ghost" icon={Plus} disabled={busy || refreshFailed || archived} onClick={()=>onAddLoan(record)}>Add loan</Button></div>
            {children.length ? <ul>{children.map((account)=><li key={account.id}><button type="button" onClick={()=>openAccount(account)} disabled={busy || refreshFailed}><span><strong>{account.name}</strong><small>{account.apr_basis_points == null ? "APR not entered" : `${(account.apr_basis_points/100).toFixed(2)}% APR`}{account.active===false ? " · Archived" : ""}{account.net_worth_included===false ? " · Breakdown only" : ""}</small>{account.accrued_interest_cents != null && <small>Reported interest {money(account.accrued_interest_cents,account.currency || currency)} · {account.accrued_interest_as_of ? `as of ${prettyDate(account.accrued_interest_as_of)}, ${account.accrued_interest_as_of.slice(0,4)}` : "date not entered"}{account.accrued_interest_stale ? " · stale, excluded" : ""}</small>}</span><strong>{money(Math.abs(account.balance_cents),account.currency || currency)}</strong><ArrowUpRight size={16} aria-hidden="true"/></button></li>)}</ul> : <p className="drawer-muted">No individual loans linked yet.</p>}
          </section>
          {linked && <section className="student-group-account-section"><h3>Servicer total account</h3><ul><li><button type="button" onClick={()=>openAccount(linked)} disabled={busy || refreshFailed}><span><strong>{linked.name}</strong><small>{record.valuation_mode==="servicer_total" ? "Counts in net worth" : "Retained total · not counted"}{linked.active===false ? " · Archived" : ""}</small></span><strong>{money(Math.abs(linked.balance_cents),linked.currency || currency)}</strong><ArrowUpRight size={16} aria-hidden="true"/></button></li></ul></section>}
          <section className="student-group-payment-summary"><h3>Payment schedules</h3><p>{money(record.scheduled_payment_cents,currency)} planned this month across the group's account schedules.</p>{record.duplicate_schedule_sources && <p className="student-group-notice"><AlertCircle size={16}/><span>Both the servicer total and individual loans have payments scheduled. Review their account schedules; none are stopped automatically.</span></p>}<p className="drawer-muted">Open an account to review its own payments and history.</p></section>
        </>}
        {editing ? <StudentLoanGroupForm key={`${record.id || "new"}-${record.currency || "USD"}`} group={record} groups={groups} accounts={accounts} busy={busy} onSave={save} onCancel={()=>{if(!record.id)onClose();else setEditing(false);}}/> : <div className="student-group-controls"><Button className="student-group-edit" variant="secondary" icon={Pencil} disabled={busy || refreshFailed || archiving || archived} onClick={()=>{restore.current=".student-group-edit";setEditing(true);setError("");}}>Manage group</Button><Button className="student-group-archive-trigger" variant="ghost" icon={Archive} disabled={busy || refreshFailed || archiving || archived} onClick={()=>{restore.current=".student-group-archive-trigger";setArchiving(true);}}>Archive group</Button></div>}
        {archiving && <div className="student-group-archive"><p>Archive {record.name}? Accounts, balances and histories stay. Each account keeps its current net-worth inclusion; excluded breakdown accounts remain excluded until you explicitly change them.</p><div className="drawer-form-actions"><Button variant="secondary" disabled={busy} onClick={()=>setArchiving(false)}>Cancel</Button><Button icon={Archive} busy={busy} onClick={archive}>Archive group</Button></div></div>}
        {error && <p className="inline-error" role="alert"><AlertCircle size={16}/>{error}</p>}
        {refreshFailed && <Button className="student-group-refresh" variant="secondary" icon={RefreshCw} busy={busy} onClick={()=>{restore.current=".student-group-edit";refresh();}}>Refresh accounts</Button>}
      </div>
    </dialog>
  );
}
