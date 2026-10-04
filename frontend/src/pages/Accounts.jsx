import {
  Landmark,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  ArrowRight,
  Link2,
  CreditCard,
  ShieldCheck,
} from "lucide-react";
import { money } from "../lib/format.js";
import { IconButton, Button, Empty } from "../components/ui.jsx";
export default function Accounts({
  demo,
  scope,
  dash,
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
}) {
  return (
    <>
      <div className="accounts-intro">
        <div className="net-worth">
          <p className="eyebrow">THE BIG PICTURE</p>
          <h2>
            {money(
              accounts
                .filter((a) => (a.currency || "USD") === "USD")
                .reduce(
                  (s, a) =>
                    s +
                    (["credit", "loan"].includes(a.kind)
                      ? -Math.abs(a.balance_cents)
                      : a.balance_cents),
                  0,
                ),
            )}
          </h2>
          <span>
            USD net balance
            {accounts.some((a) => a.currency !== "USD")
              ? " · Other currencies shown separately"
              : ""}
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
      <div className="account-grid">
        {accounts.map((a) => (
          <section className="card account-card" key={a.id}>
            <div className="account-card-top">
              <span className="account-icon">
                {a.kind === "credit" ? (
                  <CreditCard size={24} />
                ) : (
                  <Landmark size={24} />
                )}
              </span>
              <div className="account-tools">
                <span
                  className={`pill ${a.source === "simplefin" ? "green" : "neutral"}`}
                >
                  {a.source === "simplefin" ? "Connected" : "Manual"}
                </span>
                <IconButton
                  label={`Edit ${a.name}`}
                  onClick={() => open("account", a)}
                >
                  <Pencil size={14} />
                </IconButton>
                <IconButton
                  label={`Delete ${a.name}`}
                  onClick={() => deleteItem("account", a)}
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </div>
            <p className="eyebrow">{a.institution || "YOUR ACCOUNT"}</p>
            <h2>{a.name}</h2>
            <strong
              className={`account-balance ${a.balance_cents < 0 ? "amount-negative" : ""}`}
            >
              {money(
                ["credit", "loan"].includes(a.kind)
                  ? -Math.abs(a.balance_cents)
                  : a.balance_cents,
                a.currency || "USD",
              )}
            </strong>
            <div className="account-card-bottom">
              <span>{a.kind?.replace("_", " ") || "Account"}</span>
              <span>{a.currency || "USD"}</span>
            </div>
          </section>
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
          Manage connection
          <ArrowRight size={14} />
        </button>
      </div>
    </>
  );
}
