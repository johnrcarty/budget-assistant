import { useState, useEffect, useRef } from "react";
import {
  Home,
  LayoutDashboard,
  Wallet,
  CalendarDays,
  ArrowLeftRight,
  Landmark,
  Settings,
  ChevronLeft,
  ChevronRight,
  X,
  RefreshCw,
  Leaf,
  LockKeyhole,
  Users,
  LogOut,
  Menu,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { api, getToken, setToken } from "./lib/api.js";
import {
  today,
  thisMonth,
  monthLabel,
  stepMonth,
  cents,
} from "./lib/format.js";
import { IconButton, Button, Brand } from "./components/ui.jsx";
import Auth from "./components/Auth.jsx";
import BudgetDialog from "./components/BudgetDialog.jsx";
import IncomeDialog from "./components/IncomeDialog.jsx";
import Overview from "./pages/Overview.jsx";
import Budget from "./pages/Budget.jsx";
import Bills from "./pages/Bills.jsx";
import Transactions from "./pages/Transactions.jsx";
import Accounts from "./pages/Accounts.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
const navItems = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "budget", label: "Budget", icon: Wallet },
  { id: "bills", label: "Bills", icon: CalendarDays },
  { id: "transactions", label: "Transactions", icon: ArrowLeftRight },
  { id: "accounts", label: "Accounts", icon: Landmark },
  { id: "settings", label: "Settings", icon: Settings },
];
export default function App() {
  const [authStatus, setAuthStatus] = useState(null),
    [user, setUser] = useState(null),
    [authError, setAuthError] = useState("");
  const [tab, setTab] = useState("overview"),
    [scope, setScope] = useState("household"),
    [month, setMonth] = useState(thisMonth),
    [mobileNav, setMobileNav] = useState(false);
  const reloadSequence = useRef(0);
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState(""),
    [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState(""),
    [toast, setToast] = useState(null),
    [filter, setFilter] = useState(""),
    [flowSpent, setFlowSpent] = useState(false),
    [haToken, setHaToken] = useState(null);
  const query = `scope=${scope}&month=${month}`;
  const activeQuery = useRef(query);
  activeQuery.current = query;
  async function boot() {
    setAuthError("");
    try {
      const status = await api("auth/status");
      setAuthStatus(status);
      if (status.mode === "ingress" || getToken()) {
        try {
          const me = await api("me");
          setUser(me);
          setMonth(thisMonth(me.timezone));
        } catch {
          setToken(null);
        }
      }
    } catch (e) {
      setAuthError(e.message);
    }
  }
  useEffect(() => {
    boot();
  }, []);
  async function reload() {
    if (query !== activeQuery.current) return;
    const sequence = ++reloadSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const [
        dashboard,
        items,
        bills,
        transactions,
        accounts,
        settings,
        income,
      ] = await Promise.all([
        api(`dashboard?${query}`),
        api(`budget/items?${query}`),
        api(`bills?${query}`),
        api(`transactions?${query}`),
        api(`accounts?${query}`),
        api(`settings?${query}`),
        api(`income?${query}`),
      ]);
      if (sequence === reloadSequence.current)
        setData({
          dashboard,
          items,
          bills,
          transactions,
          accounts,
          settings,
          income,
        });
    } catch (e) {
      if (sequence === reloadSequence.current) setLoadError(e.message);
    } finally {
      if (sequence === reloadSequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (user) reload();
  }, [user, scope, month]);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(id);
    }
  }, [toast]);
  useEffect(() => {
    setFilter("");
  }, [tab]);
  function changeScope(next) {
    if (next === scope) return;
    reloadSequence.current++;
    setData(null);
    setModal(null);
    setScope(next);
  }
  function changeMonth(next) {
    if (next === month) return;
    reloadSequence.current++;
    setData(null);
    setModal(null);
    setMonth(next);
  }
  function notify(text) {
    setToast(text);
  }
  function open(type, item = null) {
    setFormError("");
    setModal({ type, item });
  }
  async function mutate(path, method, body, message, close = true) {
    setBusy(true);
    setFormError("");
    try {
      const result = await api(path, { method, body });
      if (close) setModal(null);
      notify(typeof message === "function" ? message(result) : message);
      await reload();
      return result;
    } catch (e) {
      setFormError(e.message);
      if (!modal) notify(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function paid(bill) {
    try {
      await mutate(
        `bills/${bill.id}?${query}`,
        "PATCH",
        { paid: !bill.paid },
        bill.paid
          ? "Bill marked unpaid."
          : "A little peace of mind. Bill marked paid.",
        false,
      );
    } catch {}
  }
  async function save(e) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const type = modal.type;
    let path,
      method = "POST",
      body,
      message;
    if (type === "item") {
      body = {
        scope,
        month,
        name: values.name,
        group_name: values.group_name,
        color: values.color,
        planned_cents: cents(values.amount),
      };
      path = `budget/items${modal.item?.id ? `/${modal.item.id}` : ""}?${query}`;
      if (modal.item?.id) method = "PATCH";
      message = modal.item?.id
        ? "Budget item updated."
        : "Your plan has a new purpose.";
    }
    if (type === "bill") {
      path = `bills${modal.item ? `/${modal.item.id}` : ""}?${query}`;
      method = modal.item ? "PATCH" : "POST";
      body = {
        scope,
        name: values.name,
        amount_cents: cents(values.amount),
        due_date: values.due_date,
        recurrence: values.recurrence,
        autopay: values.autopay === "on",
        paid: modal.item?.paid || false,
      };
      message = modal.item ? "Bill updated." : "Bill added to your home.";
    }
    if (type === "transaction") {
      path = `transactions${modal.item ? `/${modal.item.id}` : ""}?${query}`;
      method = modal.item ? "PATCH" : "POST";
      body = {
        scope,
        description: values.description,
        amount_cents:
          cents(values.amount) * (values.direction === "income" ? 1 : -1),
        date: values.date,
        account_name: values.account_name || "Manual entry",
        category_id: values.category_id ? Number(values.category_id) : null,
      };
      message = modal.item ? "Transaction updated." : "Transaction recorded.";
    }
    if (type === "account") {
      path = `accounts${modal.item ? `/${modal.item.id}` : ""}?${query}`;
      method = modal.item ? "PATCH" : "POST";
      body = {
        scope,
        name: values.name,
        institution: values.institution,
        kind: values.kind,
        balance_cents: cents(values.amount),
        currency: values.currency,
      };
      message = modal.item ? "Account updated." : "Account added.";
    }
    if (type === "simplefin") {
      path = "integrations/simplefin";
      body = { setup_token: values.setup_token, scope };
      message = "SimpleFIN connected. Your accounts are ready to sync.";
    }
    if (type === "member") {
      path = "members";
      body = {
        username: values.username,
        display_name: values.display_name,
        password: values.password,
      };
      message = "Household member added.";
    }
    if (type === "copy") {
      path = "budget/copy";
      body = { scope, from_month: values.from_month, to_month: month };
      message = `Your ${monthLabel(month)} plan is ready.`;
    }
    try {
      await mutate(path, method, body, message);
    } catch {}
  }
  async function confirmDelete() {
    const { kind, id } = modal.item;
    const resource = {
      item: "budget/items",
      bill: "bills",
      transaction: "transactions",
      account: "accounts",
    }[kind];
    try {
      await mutate(
        `${resource}/${id}?${query}`,
        "DELETE",
        undefined,
        "Removed.",
      );
    } catch {}
  }
  async function saveIncome(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const item = modal.item;
    const day = (value) => (value === "last" ? "last" : Number(value));
    const base = { name: values.name, amount_cents: cents(values.amount) };
    let path,
      method = "POST",
      body,
      message;
    if (modal.type === "income-entry") {
      path = `income/entries/${item.id}?${query}`;
      method = "PATCH";
      body = { ...base, date: values.date || null };
      message = item.source_id
        ? "This payment has been adjusted."
        : "Income updated.";
    } else if (values.cadence === "manual") {
      path = `income/entries?${query}`;
      body = {
        ...base,
        date: values.date || null,
        ...(!item ? { replace_legacy: values.replace_legacy === "on" } : {}),
      };
      message = "Your income has a place in the plan.";
    } else {
      path = `income/sources${item ? `/${item.id}` : ""}?${query}`;
      method = item ? "PATCH" : "POST";
      body = {
        ...base,
        cadence: values.cadence,
        anchor_date: values.anchor_date,
        effective_from: `${values.effective_month || month}-01`,
        ...(!item ? { replace_legacy: values.replace_legacy === "on" } : {}),
        ...(values.cadence === "semimonthly"
          ? { day1: day(values.day1), day2: day(values.day2) }
          : {}),
      };
      message = item
        ? `Pay schedule updated from ${monthLabel(values.effective_month)}.`
        : "Your paydays are part of the plan.";
    }
    try {
      await mutate(path, method, body, message);
    } catch {}
  }
  async function deleteIncome(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const item = modal.item;
    const scheduled = item.kind === "source";
    const path = scheduled
      ? `income/sources/${item.id}?${query}&effective_from=${values.effective_month}-01`
      : `income/entries/${item.id}?${query}`;
    try {
      await mutate(
        path,
        "DELETE",
        undefined,
        scheduled
          ? `Pay schedule stops from ${monthLabel(values.effective_month)}.`
          : "Expected income removed.",
      );
    } catch {}
  }
  async function resetIncome(entry) {
    try {
      await mutate(
        `income/entries/${entry.id}/reset?${query}`,
        "POST",
        undefined,
        "The scheduled payment is restored.",
        false,
      );
    } catch {}
  }
  async function restoreSkippedIncome(event) {
    event.preventDefault();
    try {
      await mutate(
        `income/sources/${modal.item.id}/restore-skipped?${query}&effective_from=${month}-01`,
        "POST",
        undefined,
        (result) =>
          result.restored_count > 0
            ? `${result.restored_count} skipped payday${result.restored_count === 1 ? "" : "s"} restored from ${monthLabel(month)} onward.`
            : "No skipped paydays remained.",
      );
    } catch {}
  }
  function deleteItem(kind, item) {
    open("delete", {
      kind,
      id: item.id,
      name: item.name || item.description,
      recurrence: item.recurrence,
    });
  }
  async function sync() {
    setBusy(true);
    try {
      const result = await api("integrations/simplefin/sync", {
        method: "POST",
        body: { scope },
      });
      notify(result.message || "Accounts and transactions synced.");
      await reload();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function generateToken() {
    setBusy(true);
    try {
      const result = await api("integrations/ha-token", { method: "POST" });
      setHaToken(result.token);
      notify("Home Assistant token created. Save it somewhere safe.");
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function share(value) {
    try {
      await mutate(
        "settings",
        "PATCH",
        { share_personal_totals: value },
        value
          ? "Your totals are now included in the household."
          : "Your personal totals are private.",
        false,
      );
    } catch {}
  }
  function signOut() {
    reloadSequence.current++;
    setToken(null);
    setUser(null);
    setData(null);
    setHaToken(null);
  }
  const dash = data?.dashboard || {},
    groups = dash.groups || [],
    transactions = data?.transactions || [],
    bills = data?.bills || [],
    accounts = data?.accounts || [],
    items = data?.items || [];
  const unpaid = bills
    .filter((b) => !b.paid)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const displayTransactions = transactions.filter((t) =>
    `${t.description} ${t.category_name || ""} ${t.account_name || ""}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const billSummary = dash.bill_summary || {};
  const remaining =
    dash.remaining_cents ?? (dash.income_cents || 0) - (dash.spent_cents || 0);
  const settings = data?.settings || {};
  const income = data?.income || { entries: [], sources: [], total_cents: 0 };
  const viewProps = {
    demo: authStatus?.demo,
    localAuth: authStatus?.local_auth,
    scope,
    dash,
    income,
    groups,
    transactions,
    bills,
    accounts,
    settings,
    month,
    user,
    data,
    remaining,
    billSummary,
    unpaid,
    busy,
    filter,
    setFilter,
    flowSpent,
    setFlowSpent,
    haToken,
    navigate,
    open,
    paid,
    deleteItem,
    sync,
    share,
    generateToken,
    notify,
    displayTransactions,
    resetIncome,
  };
  function navigate(id) {
    setTab(id);
    setMobileNav(false);
  }
  if (authError)
    return (
      <div className="boot-screen">
        <Brand />
        <AlertCircle size={32} />
        <h2>Home is a connection away.</h2>
        <p>{authError}</p>
        <Button onClick={boot} icon={RefreshCw}>
          Try again
        </Button>
      </div>
    );
  if (!authStatus)
    return (
      <div className="boot-screen">
        <Brand />
        <LoaderCircle className="spinning" size={28} />
        <p>Getting your home in order…</p>
      </div>
    );
  if (!user && authStatus.mode === "ingress" && !authStatus.local_auth)
    return (
      <div className="boot-screen">
        <Brand />
        <ShieldCheck size={30} />
        <h2>Open from Home Assistant.</h2>
        <p>
          This instance uses Home Assistant ingress. Open its sidebar panel to
          sign in with your Home Assistant account.
        </p>
        <Button onClick={boot} icon={RefreshCw}>
          Check connection
        </Button>
      </div>
    );
  if (!user)
    return (
      <Auth
        status={authStatus}
        onAuthenticated={(me) => {
          setUser(me);
          setMonth(thisMonth(me.timezone));
        }}
      />
    );
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <Brand />
        <div className="household-label">
          <span className="household-icon">
            <Home size={18} />
          </span>
          <div>
            <strong>{user.household_name || "Our home"}</strong>
            <small>Your household</small>
          </div>
          <Leaf size={15} />
        </div>
        <p className="nav-label">YOUR FINANCES</p>
        <nav aria-label="Main navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              className={`nav-link ${tab === id ? "active" : ""}`}
              key={id}
              onClick={() => navigate(id)}
              aria-current={tab === id ? "page" : undefined}
            >
              <Icon size={19} strokeWidth={1.7} />
              <span>{label}</span>
              {id === "bills" &&
                (billSummary.past_due?.count || billSummary.today?.count) >
                  0 && (
                  <span className="nav-badge">
                    {(billSummary.past_due?.count || 0) +
                      (billSummary.today?.count || 0)}
                  </span>
                )}
              {tab === id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="home-note">
            <div className="home-note-sun" />
            <Leaf size={20} />
            <p>
              A little planning.
              <br />
              <strong>A lot more living.</strong>
            </p>
            <span>Let your money feel at home.</span>
          </div>
          <div className="sidebar-user">
            <span className="avatar">{user.display_name?.[0] || "Y"}</span>
            <div>
              <strong>{user.display_name || user.username}</strong>
              <small>
                {authStatus.mode === "ingress"
                  ? "Home Assistant account"
                  : "Your own quiet corner"}
              </small>
            </div>
            {authStatus.mode !== "ingress" && (
              <IconButton label="Sign out" onClick={signOut}>
                <LogOut size={16} />
              </IconButton>
            )}
          </div>
        </div>
      </aside>
      {mobileNav && (
        <div
          className="mobile-nav-backdrop"
          onClick={() => setMobileNav(false)}
        />
      )}
      <main className="main-content">
        <div className="topbar">
          <div className="breadcrumbs">
            <IconButton
              label="Open navigation"
              onClick={() => setMobileNav(!mobileNav)}
              className="mobile-menu"
            >
              <Menu size={21} />
            </IconButton>
            <Home size={14} />
            <span>{user.household_name || "Our home"}</span>
            <ChevronRight size={12} />
            <strong>{navItems.find((n) => n.id === tab)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span
              className={`local-pill ${authStatus.demo ? "sample-pill" : ""}`}
            >
              <span />
              {authStatus.demo ? "Sample household" : "At home, on your server"}
            </span>
            <span className="tiny-avatar">{user.display_name?.[0] || "Y"}</span>
          </div>
        </div>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {scope === "household"
                  ? "THE BIG PICTURE"
                  : "YOUR OWN QUIET CORNER"}
              </p>
              <h1>
                {tab === "overview"
                  ? "Make room for living."
                  : tab === "budget"
                    ? "Make a plan for what matters."
                    : tab === "bills"
                      ? "One less thing to remember."
                      : tab === "transactions"
                        ? "The little things add up."
                        : tab === "accounts"
                          ? "Everything, in its place."
                          : "Make yourself at home."}
              </h1>
              <p>
                {tab === "overview"
                  ? "A thoughtful look at your money, all in one place."
                  : tab === "budget"
                    ? "A plan for the things you need, and the things you love."
                    : tab === "bills"
                      ? "Keep your home running, with a clear view of what’s due."
                      : tab === "transactions"
                        ? "A clear trail of what came in and what went out."
                        : tab === "accounts"
                          ? "Your balances, connected and close to home."
                          : "Your connections, your household, your preferences."}
              </p>
            </div>
            <div className="heading-leaf" aria-hidden="true">
              <div />
              <Leaf size={33} strokeWidth={1.1} />
            </div>
          </div>
          <div className="view-toolbar">
            <div
              className="scope-toggle"
              role="group"
              aria-label="Budget visibility"
            >
              <button
                className={scope === "household" ? "selected" : ""}
                onClick={() => changeScope("household")}
              >
                <Users size={15} />
                Household
              </button>
              <button
                className={scope === "personal" ? "selected" : ""}
                onClick={() => changeScope("personal")}
              >
                <LockKeyhole size={14} />
                My budget
              </button>
            </div>
            {["overview", "budget", "transactions"].includes(tab) && (
              <div className="month-picker">
                <IconButton
                  label="Previous month"
                  onClick={() => changeMonth(stepMonth(month, -1))}
                >
                  <ChevronLeft size={16} />
                </IconButton>
                <label>
                  <CalendarDays size={15} />
                  <span>{monthLabel(month)}</span>
                  <input
                    type="month"
                    aria-label="Choose month"
                    value={month}
                    onChange={(e) =>
                      e.target.value && changeMonth(e.target.value)
                    }
                  />
                </label>
                <IconButton
                  label="Next month"
                  onClick={() => changeMonth(stepMonth(month, 1))}
                >
                  <ChevronRight size={16} />
                </IconButton>
              </div>
            )}
            {scope === "personal" && (
              <span className="privacy-note">
                <LockKeyhole size={12} />
                Only you can see these details
              </span>
            )}
          </div>
          {loadError && (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} />
              <p>{loadError}</p>
              <Button variant="ghost" onClick={reload}>
                Retry
              </Button>
            </div>
          )}
          {loading && !data ? (
            <div className="loading-state">
              <LoaderCircle className="spinning" size={26} />
              <p>Putting your picture together…</p>
            </div>
          ) : (
            data && (
              <>
                {tab === "overview" && <Overview {...viewProps} />}
                {tab === "budget" && <Budget {...viewProps} />}
                {tab === "bills" && <Bills {...viewProps} />}
                {tab === "transactions" && <Transactions {...viewProps} />}
                {tab === "accounts" && <Accounts {...viewProps} />}
                {tab === "settings" && <SettingsPage {...viewProps} />}
              </>
            )
          )}
          <footer className="page-footer">
            <span>
              <Leaf size={13} />A little clarity. A calmer home.
            </span>
            <span>BudgetAssistant · Local by nature</span>
          </footer>
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <IconButton
            label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </IconButton>
        </div>
      )}
      {modal?.type.startsWith("income") ? (
        <IncomeDialog
          key={`${modal.type}-${modal.item?.id || "new"}`}
          modal={modal}
          month={month}
          scope={scope}
          user={user}
          income={income}
          busy={busy}
          error={formError}
          onSave={saveIncome}
          onRestore={restoreSkippedIncome}
          onDelete={deleteIncome}
          onClose={() => setModal(null)}
        />
      ) : (
        modal && (
          <BudgetDialog
            modal={modal}
            user={user}
            busy={busy}
            dash={dash}
            scope={scope}
            month={month}
            groups={groups}
            accounts={accounts}
            formError={formError}
            save={save}
            confirmDelete={confirmDelete}
            onClose={() => setModal(null)}
          />
        )
      )}
    </div>
  );
}
