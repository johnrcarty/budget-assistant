import {
  Home,
  ArrowLeftRight,
  RefreshCw,
  LockKeyhole,
  AlertCircle,
  Link2,
  Copy,
  ShieldCheck,
  Clock3,
} from "lucide-react";

import { Button } from "../components/ui.jsx";
import HouseholdSettings from "../components/HouseholdSettings.jsx";
export default function SettingsPage({
  demo,
  localAuth,
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
    <div className="settings-grid">
      <section className="card setting-card">
        <div className="setting-icon">
          <LockKeyhole size={22} />
        </div>
        <p className="eyebrow">SHARED GOALS, PRIVATE DETAILS</p>
        <h2>Your personal budget</h2>
        <p>
          Include your personal budget totals in your household’s picture. Your
          categories, bills, accounts, and transactions stay visible only to
          you.
        </p>
        <label className="toggle-row">
          <div>
            <strong>Share totals with the household</strong>
            <span>Income, planned amounts, and spending only</span>
          </div>
          <input
            type="checkbox"
            checked={settings.share_personal_totals || false}
            onChange={(e) => share(e.target.checked)}
            disabled={busy}
          />
          <span className="switch" />
        </label>
        <div className="setting-footnote">
          <ShieldCheck size={15} />
          Privacy is enforced on the server.
        </div>
      </section>
      <section className="card setting-card">
        <div className="setting-icon">
          <ArrowLeftRight size={22} />
        </div>
        <p className="eyebrow">AUTOMATICALLY IN THE LOOP</p>
        <h2>SimpleFIN connection</h2>
        <p>
          Bring in your accounts and transactions without the daily upkeep. New
          transactions arrive ready for a purpose.
        </p>
        <div className="integration-status">
          <span
            className={`status-dot ${settings.simplefin_connected ? "connected" : ""}`}
          />
          <strong>
            {settings.simplefin_connected ? "Connected" : "Not connected yet"}
          </strong>
          {settings.last_sync && (
            <small>
              Last sync {new Date(settings.last_sync).toLocaleString()}
            </small>
          )}
        </div>
        {(settings.warnings || []).map((warning, i) => (
          <p key={i} className="inline-error">
            <AlertCircle size={15} />
            {warning}
          </p>
        ))}
        {settings.sync_error && (
          <p className="inline-error">
            <AlertCircle size={15} />
            {settings.sync_error}
          </p>
        )}
        <div className="header-actions">
          <Button
            variant={settings.simplefin_connected ? "secondary" : ""}
            icon={Link2}
            onClick={() => open("simplefin")}
            disabled={demo}
          >
            {settings.simplefin_connected
              ? "Update connection"
              : "Connect SimpleFIN"}
          </Button>
          {settings.simplefin_connected && (
            <Button icon={RefreshCw} busy={busy} onClick={sync}>
              Sync now
            </Button>
          )}
        </div>
        {demo && (
          <p className="muted small">
            Live bank connections are disabled in this sample household. You can
            explore with sample accounts and transactions.
          </p>
        )}
        <div className="setting-footnote">
          <Clock3 size={14} />
          Syncs every {settings.sync_interval_hours || 24} hours when connected.
        </div>
      </section>
      <section className="card setting-card ha-setting">
        <div className="setting-icon">
          <Home size={22} />
        </div>
        <p className="eyebrow">PART OF YOUR HOME</p>
        <h2>Home Assistant</h2>
        <p>
          Your home can know when a bill is unpaid and due today, this week,
          next week, or past due. Household bill counts and totals are available
          to your Home Assistant integration.
        </p>
        <div className="ha-buckets">
          <span>Past due</span>
          <span>Today</span>
          <span>This week</span>
          <span>Next week</span>
        </div>
        {user.is_admin && (
          <Button icon={ShieldCheck} busy={busy} onClick={generateToken}>
            {haToken ? "Rotate integration token" : "Create integration token"}
          </Button>
        )}
        {haToken && (
          <div className="token-box">
            <label className="field">
              <span>
                Copy this token now. It is shown until you leave this page.
              </span>
              <textarea readOnly value={haToken} rows={3} />
            </label>
            <Button
              variant="secondary"
              icon={Copy}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(haToken);
                  notify("Token copied.");
                } catch {
                  notify("Select and copy the token from the field.");
                }
              }}
            >
              Copy token
            </Button>
          </div>
        )}
        <div className="setting-footnote">
          <LockKeyhole size={14} />
          Only household bill summaries are exposed to Home Assistant.
        </div>
      </section>
      <HouseholdSettings
        user={user}
        localAuth={localAuth}
        refreshKey={data}
        onAdd={() => open("member")}
      />
    </div>
  );
}
