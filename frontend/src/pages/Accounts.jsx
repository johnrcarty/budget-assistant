import { useEffect, useState } from "react";
import {
  Landmark,
  Plus,
  Pencil,
  Archive,
  RefreshCw,
  ArrowRight,
  Link2,
  CreditCard,
  ShieldCheck,
  AlertCircle,
  LoaderCircle,
} from "lucide-react";
import { money } from "../lib/format.js";
import {
  isDebt,
  netBalance,
  debtLabels,
  scheduleLabel,
} from "../lib/accounts.js";
import { api } from "../lib/api.js";
import { IconButton, Button, Empty } from "../components/ui.jsx";
import AccountHistoryChart from "../components/AccountHistoryChart.jsx";

function AccountCard({ account, busy, open, openAccountDetails, deleteItem }) {
  const debt = isDebt(account);
  const archived = account.active === false;
  return (
    <section
      className={`card account-card ${archived ? "archived-account" : ""}`}
    >
      <div className="account-card-top">
        <span className="account-icon" aria-hidden="true">
          {debt ? <CreditCard size={24} /> : <Landmark size={24} />}
        </span>
        <div className="account-tools">
          <span
            className={`pill ${account.source === "simplefin" ? "green" : "neutral"}`}
          >
            {archived
              ? "Archived"
              : account.source === "simplefin"
                ? "Connected"
                : "Manual"}
          </span>
          <IconButton
            label={`Edit ${account.name}`}
            onClick={() => open("account", account)}
            disabled={busy}
          >
            <Pencil size={16} />
          </IconButton>
          {!archived && (
            <IconButton
              label={`Archive ${account.name}`}
              onClick={() => deleteItem("account", account)}
              disabled={busy}
            >
              <Archive size={16} />
            </IconButton>
          )}
        </div>
      </div>
      <p className="eyebrow">{account.institution || "YOUR ACCOUNT"}</p>
      <button
        className="account-name-button"
        type="button"
        onClick={() => openAccountDetails(account)}
        aria-label={`View ${account.name} account details and balance history`}
      >
        <h2>{account.name}</h2>
      </button>
      <strong
        className={`account-balance ${debt || account.balance_cents < 0 ? "amount-negative" : ""}`}
      >
        {money(
          debt ? Math.abs(account.balance_cents) : account.balance_cents,
          account.currency || "USD",
        )}
      </strong>
      {debt && <span className="account-owed-label">owed</span>}
      {debt && (
        <div className="account-debt-summary">
          <span>
            {account.apr_basis_points == null
              ? "APR not entered"
              : `${(account.apr_basis_points / 100).toFixed(2)}% APR`}
          </span>
          <span>{scheduleLabel(account.payment_schedule)}</span>
          {account.payment_schedule?.active && (
            <strong>
              {money(account.payment_schedule.amount_cents)} per payment
            </strong>
          )}
        </div>
      )}
      {debt && account.upcoming_payment_schedule && (
        <div className="account-upcoming-summary">
          <strong>
            {account.upcoming_payment_schedule.active ? "Starts" : "Stops"}{" "}
            {new Date(
              `${account.upcoming_payment_schedule.effective_from.slice(0, 7)}-15T12:00:00`,
            ).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
          </strong>
          {account.upcoming_payment_schedule.active && (
            <span>
              {money(account.upcoming_payment_schedule.amount_cents)} ·{" "}
              {scheduleLabel(account.upcoming_payment_schedule)}
            </span>
          )}
        </div>
      )}
      <div className="account-card-bottom">
        <span>
          {debtLabels[account.debt_type] ||
            account.kind?.replace("_", " ") ||
            "Account"}
        </span>
        <button
          type="button"
          className="text-button"
          onClick={() => openAccountDetails(account)}
        >
          Details <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}

export default function Accounts({
  demo,
  scope,
  accounts,
  settings,
  busy,
  navigate,
  open,
  openAccountDetails,
  deleteItem,
  sync,
}) {
  const [history, setHistory] = useState(null);
  const [accountHistory, setAccountHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [currency, setCurrency] = useState("USD");
  const [metric, setMetric] = useState("net_worth_cents");
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState("");
  const active = accounts.filter((account) => account.active !== false);
  const currencies = [
    ...new Set([
      ...accounts.map((account) => account.currency || "USD"),
      ...(history?.series || []).map((series) => series.currency),
    ]),
  ].sort();
  const scopedAccounts = active.filter(
    (account) => (account.currency || "USD") === currency,
  );
  const total = scopedAccounts.reduce(
    (sum, account) => sum + netBalance(account),
    0,
  );
  const selectedAccount = metric.startsWith("account:")
    ? accounts.find((account) => account.id === Number(metric.slice(8)))
    : null;
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setHistory(null);
    setError("");
    api(`accounts/net-worth/history?scope=${scope}`, { signal: abort.signal })
      .then((result) => {
        if (abort.signal.aborted) return;
        setHistory(result);
        const available = result.series?.map((series) => series.currency) || [];
        if (available.length && !available.includes(currency))
          setCurrency(available.includes("USD") ? "USD" : available[0]);
      })
      .catch((failure) => {
        if (!abort.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [scope, accounts, revision]);
  useEffect(() => {
    setAccountHistory(null);
    setAccountError("");
    if (!selectedAccount) return;
    const abort = new AbortController();
    setAccountLoading(true);
    api(`accounts/${selectedAccount.id}/history?scope=${scope}`, {
      signal: abort.signal,
    })
      .then((result) => {
        if (!abort.signal.aborted) setAccountHistory(result);
      })
      .catch((failure) => {
        if (!abort.signal.aborted) setAccountError(failure.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setAccountLoading(false);
      });
    return () => abort.abort();
  }, [scope, selectedAccount?.id, accounts, revision]);
  const series = history?.series?.find((entry) => entry.currency === currency);
  const label = selectedAccount
    ? `${selectedAccount.name} balance`
    : {
        net_worth_cents: "Net worth",
        assets_cents: "Assets",
        liabilities_cents: "Debt balances",
      }[metric];
  return (
    <>
      <div className="accounts-intro">
        <div className="net-worth">
          <p className="eyebrow">NET WORTH · {currency}</p>
          <h2>{money(total, currency)}</h2>
          <span>
            {scopedAccounts.length} active account
            {scopedAccounts.length === 1 ? "" : "s"}
            {currencies.length > 1 ? " · Currencies kept separate" : ""}
          </span>
        </div>
        <div className="header-actions">
          <Button
            variant="secondary"
            icon={RefreshCw}
            busy={busy}
            onClick={sync}
            disabled={!settings.simplefin_connected}
          >
            Sync accounts
          </Button>
          <Button onClick={() => open("account")} icon={Plus}>
            Add account
          </Button>
        </div>
      </div>
      <section className="card accounts-history-card">
        <div className="card-heading">
          <h2>Balance history</h2>
          <div className="account-chart-controls">
            <label>
              <span className="sr-only">History currency</span>
              <select
                value={currency}
                onChange={(event) => {
                  setCurrency(event.target.value);
                  if (!selectedAccount) setMetric("net_worth_cents");
                }}
              >
                {(currencies.length ? currencies : ["USD"]).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Balance history view</span>
              <select
                value={metric}
                onChange={(event) => setMetric(event.target.value)}
              >
                <option value="net_worth_cents">Net worth</option>
                <option value="assets_cents">All assets</option>
                <option value="liabilities_cents">All debts</option>
                {accounts.map((account) => (
                  <option value={`account:${account.id}`} key={account.id}>
                    {account.name}
                    {account.active === false ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {loading || (selectedAccount && accountLoading) ? (
          <div className="account-history-loading">
            <LoaderCircle className="spinning" size={23} />
            <p>Loading observed balances…</p>
          </div>
        ) : error || accountError ? (
          <div className="account-history-error" role="alert">
            <AlertCircle size={18} />
            <p>{error || accountError}</p>
            <Button
              variant="secondary"
              onClick={() => setRevision((value) => value + 1)}
            >
              Retry
            </Button>
          </div>
        ) : (
          <AccountHistoryChart
            points={
              selectedAccount
                ? (accountHistory?.points || []).filter(
                    (point) =>
                      (point.currency || accountHistory?.currency) === currency,
                  )
                : series?.points || []
            }
            currency={currency}
            valueKey={selectedAccount ? "balance_cents" : metric}
            label={label}
            id="all-account-history"
            netWorth={!selectedAccount}
          />
        )}
      </section>
      <div className="account-grid">
        {active.map((account) => (
          <AccountCard
            key={account.id}
            account={account}
            busy={busy}
            open={open}
            openAccountDetails={openAccountDetails}
            deleteItem={deleteItem}
          />
        ))}
      </div>
      {!accounts.length && (
        <section className="card">
          <Empty
            title="Bring your accounts home."
            description="Connect SimpleFIN for automatic transactions, or add an account yourself."
            icon={Landmark}
            action={
              <div className="empty-actions">
                <Button
                  icon={Link2}
                  onClick={() => open("simplefin")}
                  disabled={demo}
                >
                  Connect SimpleFIN
                </Button>
                <Button
                  variant="secondary"
                  icon={Plus}
                  onClick={() => open("account")}
                >
                  Add manually
                </Button>
              </div>
            }
          />
        </section>
      )}
      <div className="connection-note">
        <ShieldCheck size={20} />
        <div>
          <strong>A connection you control.</strong>
          <p>
            SimpleFIN provides read-only account access. BudgetAssistant never
            needs your bank password.
          </p>
        </div>
        <button className="text-button" onClick={() => navigate("settings")}>
          Manage connection <ArrowRight size={14} />
        </button>
      </div>
    </>
  );
}
