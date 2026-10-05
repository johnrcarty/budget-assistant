import { useState, useEffect, useRef } from "react";
import {
  Home,
  LayoutDashboard,
  Wallet,
  CalendarDays,
  ArrowLeftRight,
  Landmark,
  Settings,
  ChevronRight,
  X,
  RefreshCw,
  Leaf,
  LogOut,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { api, getToken, setToken } from "./lib/api.js";
import { today, thisMonth, monthLabel, cents } from "./lib/format.js";
import { transactionDetailsBody } from "./lib/transactions.js";
import { IconButton, Button, Brand, PageHeading } from "./components/ui.jsx";
import Auth from "./components/Auth.jsx";
import BudgetDialog from "./components/BudgetDialog.jsx";
import AccountDialog from "./components/AccountDialog.jsx";
import AccountDetails from "./components/AccountDetails.jsx";
import StudentLoanGroupDetails from "./components/StudentLoanGroupDetails.jsx";
import CategoryDialog from "./components/CategoryDialog.jsx";
import ItemDetails from "./components/ItemDetails.jsx";
import IncomeDialog from "./components/IncomeDialog.jsx";
import TransactionDialog from "./components/TransactionDialog.jsx";
import MobileNav, { mobilePageIds } from "./components/MobileNav.jsx";
import CategorizationRules from "./components/CategorizationRules.jsx";
import Overview from "./pages/Overview.jsx";
import Budget from "./pages/Budget.jsx";
import Bills from "./pages/Bills.jsx";
import Transactions from "./pages/Transactions.jsx";
import Accounts from "./pages/Accounts.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import AnnualIncomeTracker from "./pages/AnnualIncomeTracker.jsx";
const navItems = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "budget", label: "Budget", icon: Wallet },
  { id: "bills", label: "Bills", icon: CalendarDays },
  { id: "transactions", label: "Transactions", icon: ArrowLeftRight },
  { id: "accounts", label: "Accounts", icon: Landmark },
  { id: "income-tracker", label: "Income tracker", icon: TrendingUp },
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
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 640px)").matches,
  );
  const sidebarRef = useRef(null);
  const mobileNavTrigger = useRef(null);
  const mobileMenuOpen = isMobile && mobileNav;
  const reloadSequence = useRef(0);
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState(""),
    [modal, setModal] = useState(null),
    [selectedItem, setSelectedItem] = useState(null),
    [selectedAccount, setSelectedAccount] = useState(null),
    [selectedLoanGroup, setSelectedLoanGroup] = useState(null),
    [rulesContext, setRulesContext] = useState(null),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState(""),
    [toast, setToast] = useState(null),
    [filter, setFilter] = useState(""),
    [showTransfers, setShowTransfers] = useState(false),
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
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    function updateLayout() {
      setIsMobile(media.matches);
      if (!media.matches) setMobileNav(false);
    }
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);
  useEffect(() => {
    if (!mobileMenuOpen || !sidebarRef.current) return;
    const panel = sidebarRef.current;
    const previousFocus = mobileNavTrigger.current || document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.querySelector(".sidebar-close")?.focus();
    function containFocus(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileNav(false);
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...panel.querySelectorAll("button:not(:disabled)"),
      ].filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", containFocus);
    return () => {
      document.removeEventListener("keydown", containFocus);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected && previousFocus.getClientRects().length)
        previousFocus.focus();
      else if (!window.matchMedia("(max-width: 640px)").matches) {
        const activePage = panel.querySelector(
          '.nav-link[aria-current="page"]',
        );
        if (activePage?.isConnected && activePage.getClientRects().length)
          activePage.focus();
      }
    };
  }, [mobileMenuOpen]);
  async function reload() {
    if (query !== activeQuery.current) return false;
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
        categories,
        studentLoanGroups,
      ] = await Promise.all([
        api(`dashboard?${query}`),
        api(`budget/items?${query}`),
        api(`bills?${query}`),
        api(`transactions?${query}&include_transfers=true`),
        api(`accounts?${query}`),
        api(`settings?${query}`),
        api(`income?${query}`),
        api(`budget/categories?${query}`),
        api(`student-loan-groups?${query}`),
      ]);
      if (sequence !== reloadSequence.current || query !== activeQuery.current)
        return false;
      setData({
        dashboard,
        items,
        bills,
        transactions,
        accounts,
        settings,
        income,
        categories,
        studentLoanGroups,
      });
      setModal((current) => {
        if (current?.type !== "transaction" || !current.item?.id)
          return current;
        const latest =
          transactions.find(
            (transaction) => transaction.id === current.item.id,
          ) ||
          (income.entries || [])
            .flatMap((entry) => entry.linked_transactions || [])
            .find((transaction) => transaction.id === current.item.id);
        return latest
          ? { ...current, item: { ...current.item, ...latest } }
          : current;
      });
      return true;
    } catch (e) {
      if (sequence === reloadSequence.current) setLoadError(e.message);
      return false;
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
    setSelectedItem(null);
    setSelectedAccount(null);
    setSelectedLoanGroup(null);
    setRulesContext(null);
    setShowTransfers(false);
    setScope(next);
  }
  function changeMonth(next) {
    if (next === month) return;
    reloadSequence.current++;
    setData(null);
    setModal(null);
    setSelectedItem(null);
    setSelectedAccount(null);
    setSelectedLoanGroup(null);
    setRulesContext(null);
    setMonth(next);
  }
  function notify(text) {
    setToast(text);
  }
  function open(type, item = null) {
    setFormError("");
    setSelectedItem(null);
    setSelectedAccount(null);
    setSelectedLoanGroup(null);
    setRulesContext(null);
    setModal({ type, item });
  }
  function openRules(transaction = null) {
    setFormError("");
    setSelectedItem(null);
    setSelectedAccount(null);
    setSelectedLoanGroup(null);
    setModal(null);
    setRulesContext({
      transaction,
      returnModal: transaction
        ? { type: "transaction", item: transaction._return_item || transaction }
        : null,
    });
  }
  function closeRules() {
    const returnModal = rulesContext?.returnModal;
    setRulesContext(null);
    if (returnModal) setModal(returnModal);
  }
  async function useTransactionRules(transaction) {
    const result = await mutate(
      `transactions/${transaction.id}/categorization/reset?${query}`,
      "POST",
      undefined,
      "Transaction returned to categorization rules.",
      false,
    );
    setModal((current) =>
      current?.type === "transaction" && current.item?.id === result.id
        ? { ...current, item: result }
        : current,
    );
    return result;
  }
  function updateOpenTransaction(result) {
    setModal((current) =>
      current?.type === "transaction" && current.item?.id === result.id
        ? { ...current, item: result }
        : current,
    );
  }
  async function resetTransactionTreatment(transaction) {
    const result = await mutate(
      `transactions/${transaction.id}?${query}`,
      "PATCH",
      { provider_role_override: null },
      "Bank treatment restored.",
      false,
    );
    updateOpenTransaction(result);
    return result;
  }
  function openTransactionReceipt(receipt) {
    open(
      "transaction",
      (data?.transactions || []).find(
        (transaction) => transaction.id === receipt.id,
      ) || receipt,
    );
  }
  function openItemDetails(item) {
    setModal(null);
    setSelectedAccount(null);
    setSelectedLoanGroup(null);
    setSelectedItem(item);
  }
  function openAccountDetails(account) {
    if (!account) return;
    setModal(null);
    setSelectedItem(null);
    setSelectedLoanGroup(null);
    setSelectedAccount(account);
  }
  function openLoanGroup(group = null) {
    setModal(null);
    setSelectedItem(null);
    setSelectedAccount(null);
    setRulesContext(null);
    setSelectedLoanGroup(group || {});
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
  async function save(e, transactionBaseline) {
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
        budget_category_id: Number(values.budget_category_id),
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
      path = `transactions${modal.item?.id ? `/${modal.item.id}` : ""}?${query}`;
      method = modal.item?.id ? "PATCH" : "POST";
      try {
        body = {
          scope,
          ...transactionDetailsBody(
            values,
            modal.item,
            transactionBaseline || modal.item,
          ),
        };
      } catch (e) {
        setFormError(e.message);
        return null;
      }
      message = modal.item?.id
        ? "Transaction updated."
        : "Transaction recorded.";
    }
    if (type === "account") {
      path = `accounts${modal.item?.id ? `/${modal.item.id}` : ""}?${query}`;
      method = modal.item?.id ? "PATCH" : "POST";
      body = {
        scope,
        name: values.name,
        institution: values.institution,
        kind: values.kind,
        balance_cents:
          ["loan", "credit"].includes(values.kind) &&
          modal.item?.balance_cents < 0
            ? -Math.abs(cents(values.amount))
            : cents(values.amount),
        currency: values.currency,
        ...(["loan", "credit"].includes(values.kind)
          ? {
              original_balance_cents: values.original_amount
                ? cents(values.original_amount)
                : null,
              apr_basis_points: values.apr
                ? Math.round(Number(values.apr) * 100)
                : null,
              debt_type: values.debt_type || null,
              opened_date: values.opened_date || null,
              term_months: values.term_months
                ? Number(values.term_months)
                : null,
              notes: values.notes || null,
              accrued_interest_cents: values.accrued_interest
                ? cents(values.accrued_interest)
                : null,
              accrued_interest_as_of: values.accrued_interest_as_of || null,
            }
          : {
              original_balance_cents: null,
              apr_basis_points: null,
              debt_type: null,
              opened_date: null,
              term_months: null,
              notes: null,
              accrued_interest_cents: null,
              accrued_interest_as_of: null,
            }),
      };
      if (
        modal.item?.id &&
        body.balance_cents === modal.item.balance_cents &&
        body.currency === modal.item.currency
      )
        delete body.balance_cents;
      if (
        modal.item?.id &&
        body.currency === modal.item.currency &&
        body.accrued_interest_cents ===
          (modal.item.accrued_interest_cents ?? null) &&
        body.accrued_interest_as_of ===
          (modal.item.accrued_interest_as_of ?? null)
      ) {
        delete body.accrued_interest_cents;
        delete body.accrued_interest_as_of;
      }
      if (body.accrued_interest_cents === null)
        body.accrued_interest_as_of = null;
      if (!modal.item?.id && values.student_loan_group_id)
        body.student_loan_group_id = Number(values.student_loan_group_id);
      message = modal.item?.id ? "Account updated." : "Account added.";
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
      const result = await mutate(
        path,
        method,
        body,
        message,
        type !== "transaction",
      );
      if (type === "transaction")
        setModal((current) =>
          current?.type === "transaction" && current.item?.id === modal.item?.id
            ? { type: "transaction", item: result }
            : current,
        );
      return result;
    } catch {
      return null;
    }
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
        kind === "account"
          ? "Account archived. Recorded history is kept."
          : "Removed.",
      );
    } catch {}
  }
  async function saveCategory(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const category = modal.item;
    try {
      await mutate(
        `budget/categories${category ? `/${category.id}` : ""}?${query}`,
        category ? "PATCH" : "POST",
        { name: values.name, color: values.color },
        category
          ? "Category updated."
          : "Category added. Choose Add item to start filling it.",
      );
    } catch {}
  }
  async function setCategoryActive() {
    const active = modal.type === "category-restore";
    try {
      await mutate(
        `budget/categories/${modal.item.id}?${query}`,
        "PATCH",
        { active },
        active
          ? "Category reactivated."
          : "Category archived. Its items and history are kept.",
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
    setMobileNav(false);
    setToken(null);
    setUser(null);
    setData(null);
    setHaToken(null);
    setSelectedItem(null);
    setSelectedAccount(null);
    setSelectedLoanGroup(null);
    setRulesContext(null);
  }
  const dash = data?.dashboard || {},
    groups = dash.groups || [],
    transactions = data?.transactions || [],
    bills = data?.bills || [],
    accounts = data?.accounts || [],
    items = data?.items || [];
  const categories = data?.categories || [];
  const studentLoanGroups = data?.studentLoanGroups || [];
  const unpaid = bills
    .filter((b) => !b.paid)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const displayTransactions = transactions.filter(
    (t) =>
      (showTransfers ||
        (t.transaction_role || t.effective_provider_role || "ordinary") !==
          "bank_transfer") &&
      `${t.description} ${t.category_name || ""} ${t.income_name || ""} ${t.account_name || ""}`
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
    categories,
    transactions,
    bills,
    accounts,
    studentLoanGroups,
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
    showTransfers,
    setShowTransfers,
    flowSpent,
    setFlowSpent,
    haToken,
    navigate,
    open,
    openTransactionReceipt,
    openItemDetails,
    openAccountDetails,
    openLoanGroup,
    openBillBudget,
    openRules,
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
    setSelectedItem(null);
    setSelectedAccount(null);
    setSelectedLoanGroup(null);
    setRulesContext(null);
    setTab(id);
    setMobileNav(false);
    if (isMobile && id !== tab) window.scrollTo(0, 0);
  }
  function openBillBudget(bill) {
    if (bill.item_month) changeMonth(bill.item_month);
    navigate("budget");
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
      <aside
        ref={sidebarRef}
        id="app-sidebar"
        className={`sidebar ${mobileMenuOpen ? "open" : ""}`}
        role={mobileMenuOpen ? "dialog" : undefined}
        aria-label={mobileMenuOpen ? "More navigation" : undefined}
        aria-modal={mobileMenuOpen ? true : undefined}
        aria-hidden={isMobile && !mobileMenuOpen ? true : undefined}
        inert={isMobile && !mobileMenuOpen ? "" : undefined}
      >
        <div className="sidebar-brand">
          <Brand />
          <IconButton
            label="Close navigation"
            className="sidebar-close"
            onClick={() => setMobileNav(false)}
          >
            <X size={21} aria-hidden="true" />
          </IconButton>
        </div>
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
              type="button"
              className={`nav-link ${tab === id ? "active" : ""} ${mobilePageIds.includes(id) ? "mobile-primary-link" : ""}`}
              key={id}
              onClick={() => navigate(id)}
              aria-current={tab === id ? "page" : undefined}
            >
              <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
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
      {mobileMenuOpen && (
        <div
          className="mobile-nav-backdrop"
          onClick={() => setMobileNav(false)}
          aria-hidden="true"
        />
      )}
      <main
        className="main-content"
        inert={mobileMenuOpen ? "" : undefined}
        aria-hidden={mobileMenuOpen ? true : undefined}
      >
        <div className="topbar">
          <div className="breadcrumbs">
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
          <PageHeading
            title={
              navItems.find((item) => item.id === tab)?.label ||
              "BudgetAssistant"
            }
            scope={scope}
            month={month}
            showMonth={[
              "overview",
              "budget",
              "transactions",
              "accounts",
            ].includes(tab)}
            onScopeChange={changeScope}
            onMonthChange={changeMonth}
          />
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
                {tab === "income-tracker" && (
                  <AnnualIncomeTracker
                    key={scope}
                    scope={scope}
                    user={user}
                    notify={notify}
                  />
                )}
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
      <MobileNav
        items={navItems}
        currentPage={tab}
        onNavigate={navigate}
        moreOpen={mobileMenuOpen}
        onOpenMore={(event) => {
          mobileNavTrigger.current = event.currentTarget;
          setMobileNav(true);
        }}
      />
      {toast && (
        <div
          className="toast"
          role="status"
          inert={mobileMenuOpen ? "" : undefined}
        >
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
      {selectedItem && (
        <ItemDetails
          key={`${scope}-${month}-${selectedItem.id}`}
          initialItem={selectedItem}
          scope={scope}
          month={month}
          user={user}
          transactions={transactions}
          accounts={accounts}
          onClose={() => setSelectedItem(null)}
          categories={categories}
          onChanged={reload}
          notify={notify}
          onOpenAccount={(accountId) =>
            openAccountDetails(
              accounts.find((account) => account.id === accountId),
            )
          }
        />
      )}
      {selectedAccount && (
        <AccountDetails
          key={`${scope}-${month}-${selectedAccount.id}`}
          account={
            accounts.find((account) => account.id === selectedAccount.id) ||
            selectedAccount
          }
          scope={scope}
          month={month}
          user={user}
          accounts={accounts}
          studentLoanGroups={studentLoanGroups}
          bills={bills}
          onClose={() => setSelectedAccount(null)}
          onEdit={(account) => open("account", account)}
          onOpenAccount={openAccountDetails}
          onOpenLoanGroup={openLoanGroup}
          onChanged={reload}
          notify={notify}
        />
      )}
      {selectedLoanGroup && (
        <StudentLoanGroupDetails
          key={`${scope}-${month}-${selectedLoanGroup.id || "new"}`}
          group={
            studentLoanGroups.find(
              (group) => group.id === selectedLoanGroup.id,
            ) || selectedLoanGroup
          }
          groups={studentLoanGroups}
          accounts={accounts}
          scope={scope}
          month={month}
          onClose={() => setSelectedLoanGroup(null)}
          onChanged={reload}
          notify={notify}
          onOpenAccount={openAccountDetails}
          onAddLoan={(group) =>
            open("account", {
              kind: "loan",
              debt_type: "student",
              currency: group.currency,
              student_loan_group_id: group.id,
            })
          }
        />
      )}
      {rulesContext && (
        <CategorizationRules
          key={`${scope}-${month}-${rulesContext.transaction?.id || "manage"}`}
          scope={scope}
          month={month}
          categories={categories}
          accounts={accounts}
          initialTransaction={rulesContext.transaction}
          onClose={closeRules}
          onChanged={reload}
          notify={notify}
        />
      )}
      {modal?.type === "transaction" ? (
        <TransactionDialog
          key={`${scope}-${modal.item?.id || "new"}`}
          transaction={modal.item}
          user={user}
          scope={scope}
          month={month}
          income={income}
          groups={groups}
          accounts={accounts}
          busy={busy}
          error={formError}
          onSave={save}
          onClose={() => setModal(null)}
          onCreateRule={openRules}
          onUseRules={useTransactionRules}
          onResetTreatment={resetTransactionTreatment}
          onIncomeSaved={updateOpenTransaction}
          onChanged={reload}
        />
      ) : modal?.type.startsWith("income") ? (
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
      ) : modal?.type === "account" ? (
        <AccountDialog
          key={`account-${modal.item?.id || "new"}`}
          account={modal.item}
          studentLoanGroups={studentLoanGroups}
          busy={busy}
          error={formError}
          onSave={save}
          onClose={() => setModal(null)}
        />
      ) : modal?.type.startsWith("category") ? (
        <CategoryDialog
          key={`${modal.type}-${modal.item?.id || "new"}`}
          modal={modal}
          categories={categories}
          busy={busy}
          error={formError}
          onSave={saveCategory}
          onSetActive={setCategoryActive}
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
            categories={categories}
            accounts={accounts}
            formError={formError}
            save={save}
            confirmDelete={confirmDelete}
            onCreateRule={openRules}
            onUseRules={useTransactionRules}
            onClose={() => setModal(null)}
          />
        )
      )}
    </div>
  );
}
