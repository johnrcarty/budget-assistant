import { useEffect, useRef } from "react";
import {
  Home,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Users,
  LockKeyhole,
  ArrowUpRight,
  X,
  Leaf,
  LoaderCircle,
} from "lucide-react";
import { money, prettyDate, monthLabel, stepMonth } from "../lib/format.js";
export function IconButton({
  label,
  children,
  onClick,
  className = "",
  ...rest
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
export function Button({
  children,
  variant = "",
  busy = false,
  icon: Icon,
  className = "",
  ...props
}) {
  return (
    <button
      className={`button ${variant} ${className}`}
      disabled={busy || props.disabled}
      {...props}
    >
      {busy ? (
        <LoaderCircle size={16} className="spinning" />
      ) : Icon ? (
        <Icon size={16} />
      ) : null}
      {children}
    </button>
  );
}
export function PageHeading({
  title,
  scope,
  month,
  showMonth,
  onScopeChange,
  onMonthChange,
}) {
  const fullMonth = monthLabel(month);
  const shortMonth = new Date(`${month}-15T12:00:00`).toLocaleDateString(
    "en-US",
    { month: "short", year: "numeric" },
  );
  return (
    <>
      <h1 className="sr-only">{title}</h1>
      <div className="view-toolbar page-controls">
        <div
          className="scope-toggle"
          role="group"
          aria-label="Budget visibility"
        >
          <button
            type="button"
            className={scope === "household" ? "selected" : ""}
            aria-label="Home household budget"
            aria-pressed={scope === "household"}
            onClick={() => onScopeChange("household")}
          >
            <Users size={15} aria-hidden="true" />
            <span className="control-wide-label">Household</span>
            <span className="control-mobile-label" aria-hidden="true">
              Home
            </span>
          </button>
          <button
            type="button"
            className={scope === "personal" ? "selected" : ""}
            aria-label="My budget, personal"
            aria-pressed={scope === "personal"}
            onClick={() => onScopeChange("personal")}
          >
            <LockKeyhole size={14} aria-hidden="true" />
            <span className="control-wide-label">My budget</span>
            <span className="control-mobile-label" aria-hidden="true">
              Personal
            </span>
          </button>
        </div>
        {showMonth && (
          <div className="month-picker">
            <IconButton
              label={`Previous month, ${monthLabel(stepMonth(month, -1))}`}
              onClick={() => onMonthChange(stepMonth(month, -1))}
            >
              <ChevronLeft size={16} />
            </IconButton>
            <label>
              <CalendarDays size={15} aria-hidden="true" />
              <span className="control-wide-label" aria-hidden="true">
                {fullMonth}
              </span>
              <span className="control-mobile-label" aria-hidden="true">
                {shortMonth}
              </span>
              <input
                type="month"
                aria-label={`Choose month, ${fullMonth}`}
                value={month}
                onChange={(e) =>
                  e.target.value && onMonthChange(e.target.value)
                }
              />
            </label>
            <IconButton
              label={`Next month, ${monthLabel(stepMonth(month, 1))}`}
              onClick={() => onMonthChange(stepMonth(month, 1))}
            >
              <ChevronRight size={16} />
            </IconButton>
          </div>
        )}
        {scope === "personal" && (
          <span className="privacy-note">
            <LockKeyhole size={12} aria-hidden="true" />
            Only you can see these details
          </span>
        )}
      </div>
    </>
  );
}
export function Empty({ icon: Icon = Leaf, title, description, action }) {
  return (
    <div className="empty-state">
      <span className="empty-symbol">
        <Icon size={28} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Field({ label, children, help }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {help && <small>{help}</small>}
    </label>
  );
}
export function Modal({ title, description, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    function key(e) {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const all = [
          ...ref.current.querySelectorAll(
            'button,input,select,textarea,[tabindex="0"]',
          ),
        ].filter((x) => !x.disabled);
        const first = all[0],
          last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = prevOverflow;
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={ref}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">MAKE ROOM FOR WHAT MATTERS</p>
            <h2 id="dialog-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={21} />
          </IconButton>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Brand({ light = false }) {
  return (
    <div className={`brand ${light ? "light" : ""}`}>
      <div className="brand-mark">
        <Home size={23} strokeWidth={1.5} />
        <span />
      </div>
      <div>
        <strong>BudgetAssistant</strong>
        <small>FINANCES AT HOME</small>
      </div>
    </div>
  );
}
export function Stat({ label, value, note, icon: Icon, tone, featured }) {
  return (
    <section className={`stat-card ${tone} ${featured ? "featured" : ""}`}>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">
          <Icon size={17} strokeWidth={1.7} />
        </span>
      </div>
      <strong>{value}</strong>
      <p>
        <span />
        {note}
      </p>
      {featured && (
        <div className="stat-art" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}
    </section>
  );
}
export function Progress({ value, total, color }) {
  const over = value > total;
  return (
    <div
      className={`progress-track ${over ? "over" : ""}`}
      role="img"
      aria-label={`${money(value)} spent of ${money(total)} planned`}
    >
      <div
        style={{
          width: `${Math.min(100, total > 0 ? Math.max(0, (value / total) * 100) : value > 0 ? 100 : 0)}%`,
          background: over ? "#bf7154" : color,
        }}
      />
    </div>
  );
}
export function TransactionRow({ transaction: t, onClick }) {
  return (
    <button className="transaction-row" onClick={onClick}>
      <span
        className={`transaction-symbol ${t.amount_cents > 0 ? "income" : ""}`}
      >
        {t.amount_cents > 0 ? (
          <ArrowUpRight size={16} />
        ) : (
          <ArrowLeftRight size={16} />
        )}
      </span>
      <div>
        <strong>{t.description}</strong>
        <small>
          {t.category_name || "Uncategorized"} · {prettyDate(t.date)}
        </small>
      </div>
      <strong className={t.amount_cents > 0 ? "amount-positive" : ""}>
        {t.amount_cents > 0 ? "+" : ""}
        {money(t.amount_cents)}
      </strong>
      <ChevronRight size={13} />
    </button>
  );
}
