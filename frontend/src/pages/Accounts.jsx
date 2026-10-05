import { useEffect, useRef, useState } from "react";
import {
  Landmark,
  Plus,
  Pencil,
  Archive,
  RefreshCw,
  ArrowRight,
  Link2,
  Ellipsis,
  ChevronDown,
  ShieldCheck,
  AlertCircle,
  LoaderCircle,
} from "lucide-react";
import { money } from "../lib/format.js";
import { isDebt, netBalance, debtLabels } from "../lib/accounts.js";
import { api } from "../lib/api.js";
import { IconButton, Button, Empty } from "../components/ui.jsx";
import AccountHistoryChart from "../components/AccountHistoryChart.jsx";

const accountKinds = {
  checking: "Checking",
  savings: "Savings",
  credit: "Credit card",
  loan: "Loan",
  investment: "Investment",
  property: "Property",
  other: "Other account",
};
const currencyOrder = (first, second) =>
  first === second
    ? 0
    : first === "USD"
      ? -1
      : second === "USD"
        ? 1
        : first.localeCompare(second);

function AccountRow({
  account,
  busy,
  open,
  openAccountDetails,
  deleteItem,
  expanded,
  onExpand,
}) {
  const actions = useRef(null);
  const debt = isDebt(account);
  const archived = account.active === false;
  const type =
    debtLabels[account.debt_type] || accountKinds[account.kind] || "Account";
  const balance = money(
    debt ? Math.abs(account.balance_cents) : account.balance_cents,
    account.currency || "USD",
  );
  function chooseAction(action) {
    onExpand(null);
    actions.current?.focus();
    action();
  }
  return (
    <li
      className={`account-list-row ${archived ? "is-archived" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.preventDefault();
          onExpand(null);
          actions.current?.focus();
        }
      }}
    >
      <div className="account-row-main">
        <button
          type="button"
          className="account-row-open"
          onClick={() => openAccountDetails(account)}
          disabled={busy}
          aria-label={`View ${account.name}, ${type}, ${balance}${debt ? " owed" : ""}, ${account.currency || "USD"}${archived ? ", archived" : ""}, account details and balance history`}
        >
          <span className="account-row-copy">
            <strong>{account.name}</strong>
            <small>
              {type}
              {account.institution && (
                <span className="account-row-institution">
                  {" "}
                  · {account.institution}
                </span>
              )}
              {archived ? " · Archived" : ""}
            </small>
          </span>
          <span
            className={`account-row-balance ${debt || account.balance_cents < 0 ? "amount-negative" : ""}`}
          >
            <strong>{balance}</strong>
            {debt && <small>owed</small>}
          </span>
        </button>
        <div className="account-row-desktop-tools">
          <IconButton
            label={`Edit ${account.name}`}
            onClick={() => open("account", account)}
            disabled={busy}
          >
            <Pencil size={16} aria-hidden="true" />
          </IconButton>
          {!archived && (
            <IconButton
              label={`Archive ${account.name}`}
              onClick={() => deleteItem("account", account)}
              disabled={busy}
            >
              <Archive size={16} aria-hidden="true" />
            </IconButton>
          )}
        </div>
        <button
          type="button"
          ref={actions}
          className="icon-button account-row-more"
          aria-label={`Actions for ${account.name}`}
          aria-expanded={expanded}
          aria-controls={`account-actions-${account.id}`}
          onClick={() => onExpand(expanded ? null : account.id)}
          disabled={busy}
        >
          <Ellipsis size={21} aria-hidden="true" />
        </button>
      </div>
      <div
        id={`account-actions-${account.id}`}
        className="account-row-mobile-tools"
        hidden={!expanded}
      >
        <Button
          type="button"
          variant="secondary"
          icon={Pencil}
          onClick={() => chooseAction(() => open("account", account))}
          disabled={busy}
        >
          Edit account
        </Button>
        {!archived && (
          <Button
            type="button"
            variant="secondary"
            icon={Archive}
            onClick={() => chooseAction(() => deleteItem("account", account))}
            disabled={busy}
          >
            Archive
          </Button>
        )}
      </div>
    </li>
  );
}

function AccountGroup({
  title,
  accounts,
  currency,
  showTotal = true,
  ...rowProps
}) {
  if (!accounts.length) return null;
  const total = accounts.reduce(
    (sum, account) =>
      sum +
      (isDebt(account)
        ? Math.abs(account.balance_cents)
        : account.balance_cents),
    0,
  );
  return (
    <section className="account-list-group">
      <div className="account-group-heading">
        <h3>
          {title}
          <span>{accounts.length}</span>
        </h3>
        {showTotal && (
          <strong className={title === "Debts" ? "amount-negative" : ""}>
            {money(total, currency)}
          </strong>
        )}
      </div>
      <ul>
        {[...accounts]
          .sort(
            (a, b) =>
              a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
              a.id - b.id,
          )
          .map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              {...rowProps}
              expanded={rowProps.actionAccount === account.id}
            />
          ))}
      </ul>
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
  const [actionAccount, setActionAccount] = useState(null);
  const active = accounts.filter((account) => account.active !== false);
  const archived = accounts.filter((account) => account.active === false);
  const activeCurrencies = [
    ...new Set(active.map((account) => account.currency || "USD")),
  ].sort(currencyOrder);
  const currencies = [
    ...new Set([
      ...accounts.map((account) => account.currency || "USD"),
      ...(history?.series || []).map((series) => series.currency),
    ]),
  ].sort(currencyOrder);
  const selectedAccount = metric.startsWith("account:")
    ? accounts.find((account) => account.id === Number(metric.slice(8)))
    : null;
  useEffect(() => {
    setActionAccount(null);
  }, [scope, accounts]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    let focusedRow = null;
    function rememberActions(event) {
      if (event.target === document.body) return;
      focusedRow =
        event.target
          .closest(".account-row-more, .account-row-mobile-tools")
          ?.closest(".account-list-row") || null;
    }
    function desktopLayout() {
      if (media.matches) return;
      setActionAccount(null);
      if (
        focusedRow?.isConnected &&
        (document.activeElement === document.body ||
          focusedRow.contains(document.activeElement))
      )
        focusedRow.querySelector(".account-row-open")?.focus();
      focusedRow = null;
    }
    document.addEventListener("focusin", rememberActions);
    media.addEventListener("change", desktopLayout);
    return () => {
      document.removeEventListener("focusin", rememberActions);
      media.removeEventListener("change", desktopLayout);
    };
  }, []);
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
      <div className="accounts-list-toolbar">
        <h2>Accounts</h2>
        <div className="header-actions">
          <Button
            variant="secondary"
            icon={RefreshCw}
            busy={busy}
            onClick={sync}
            disabled={!settings.simplefin_connected}
            aria-label="Sync accounts"
            className="accounts-list-sync"
          >
            <span>Sync</span>
          </Button>
          <Button
            onClick={() => open("account")}
            icon={Plus}
            aria-label="Add account"
            disabled={busy}
          >
            Add
          </Button>
        </div>
      </div>
      <div className="compact-account-lists">
        {activeCurrencies.map((unit) => {
          const current = active.filter(
            (account) => (account.currency || "USD") === unit,
          );
          return (
            <section className="card account-currency-card" key={unit}>
              <div className="account-currency-heading">
                <h2>
                  {unit}
                  <span>
                    {current.length} account{current.length === 1 ? "" : "s"}
                  </span>
                </h2>
                <div>
                  <span>Net worth</span>
                  <strong>
                    {money(
                      current.reduce(
                        (sum, account) => sum + netBalance(account),
                        0,
                      ),
                      unit,
                    )}
                  </strong>
                </div>
              </div>
              <AccountGroup
                title="Assets"
                accounts={current.filter((account) => !isDebt(account))}
                currency={unit}
                busy={busy}
                open={open}
                openAccountDetails={openAccountDetails}
                deleteItem={deleteItem}
                actionAccount={actionAccount}
                onExpand={setActionAccount}
              />
              <AccountGroup
                title="Debts"
                accounts={current.filter(isDebt)}
                currency={unit}
                busy={busy}
                open={open}
                openAccountDetails={openAccountDetails}
                deleteItem={deleteItem}
                actionAccount={actionAccount}
                onExpand={setActionAccount}
              />
            </section>
          );
        })}
      </div>
      {archived.length > 0 && (
        <details className="card archived-account-list">
          <summary>
            Archived accounts <span>{archived.length}</span>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          {[...new Set(archived.map((account) => account.currency || "USD"))]
            .sort(currencyOrder)
            .map((unit) => (
              <AccountGroup
                key={unit}
                title={unit}
                accounts={archived.filter(
                  (account) => (account.currency || "USD") === unit,
                )}
                currency={unit}
                showTotal={false}
                busy={busy}
                open={open}
                openAccountDetails={openAccountDetails}
                deleteItem={deleteItem}
                actionAccount={actionAccount}
                onExpand={setActionAccount}
              />
            ))}
        </details>
      )}
      <details className="card accounts-history-card account-history-disclosure">
        <summary>
          <span>Balance history</span>
          <ChevronDown size={19} aria-hidden="true" />
        </summary>
        <div className="account-history-controls-row">
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
      </details>
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
