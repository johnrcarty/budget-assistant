import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowUpRight, Link2, Pencil, Unlink } from "lucide-react";
import { cents, money } from "../lib/format.js";
import {
  accountKinds,
  debtLabels,
  isDebt,
  isPaidOffLoan,
} from "../lib/accounts.js";
import { Button, Field } from "./ui.jsx";

function CollateralForm({ account, assets, busy, onSave, onCancel }) {
  const [mode, setMode] = useState(assets.length ? "existing" : "new");
  const currency = account.currency || "USD";
  const current = assets.some(
    (asset) => asset.id === account.collateral_asset_id,
  )
    ? account.collateral_asset_id
    : "";
  async function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const body =
      mode === "existing"
        ? { asset_id: Number(values.asset_id) }
        : {
            asset: {
              name: values.asset_name.trim(),
              kind: values.asset_kind,
              balance_cents: cents(values.asset_amount),
            },
          };
    if (await onSave(body)) onCancel();
  }
  return (
    <form className="collateral-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <Field label="Asset">
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <option value="existing">Link an existing asset</option>
            <option value="new">Create a new asset</option>
          </select>
        </Field>
        {mode === "existing" ? (
          <Field label={`Existing asset · ${currency}`}>
            <select name="asset_id" required defaultValue={current}>
              <option value="" disabled>
                Choose an asset
              </option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                  {asset.institution ? ` · ${asset.institution}` : ""}
                  {` · ${accountKinds[asset.kind] || "Asset"} · ${money(asset.balance_cents, currency)}`}
                </option>
              ))}
            </select>
            {!assets.length && (
              <small>
                No active assets in this currency. Choose Create a new asset.
              </small>
            )}
          </Field>
        ) : (
          <>
            <Field label="Asset name">
              <input
                name="asset_name"
                required
                maxLength={120}
                placeholder="Home, family car…"
              />
            </Field>
            <div className="form-grid">
              <Field label="Asset type">
                <select
                  name="asset_kind"
                  defaultValue={
                    account.debt_type === "auto"
                      ? "vehicle"
                      : account.debt_type === "mortgage"
                        ? "property"
                        : "other"
                  }
                >
                  <option value="property">Property</option>
                  <option value="vehicle">Vehicle</option>
                  <option value="other">Other asset</option>
                </select>
              </Field>
              <Field label="Current asset value">
                <div className="money-input">
                  <span>{currency}</span>
                  <input
                    name="asset_amount"
                    type="number"
                    min="0"
                    max="10000000000"
                    step="0.01"
                    required
                    placeholder="0.00"
                  />
                </div>
              </Field>
            </div>
          </>
        )}
        <p className="drawer-muted">
          Choose an existing asset if it is already in Accounts. It is counted
          once in net worth and stays after payoff or unlinking.
        </p>
      </fieldset>
      <div className="drawer-form-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button type="submit" icon={Link2} busy={busy}>
          {mode === "new" ? "Create and link" : "Link asset"}
        </Button>
      </div>
    </form>
  );
}

function EquityValues({ value, debtTotal, equity, currency }) {
  return (
    <dl className="collateral-values">
      <div>
        <dt>Asset value</dt>
        <dd>{money(value, currency)}</dd>
      </div>
      <div>
        <dt>Active linked debt</dt>
        <dd>{money(debtTotal, currency)}</dd>
      </div>
      <div>
        <dt>Equity</dt>
        <dd className={equity < 0 ? "amount-negative" : ""}>
          {money(equity, currency)}
        </dd>
      </div>
    </dl>
  );
}

export default function AccountCollateral({
  account,
  accounts = [],
  busy,
  error,
  refreshFailed = false,
  showRefresh = true,
  onSave,
  onRefresh,
  onEditAsset,
  onOpenAccount,
}) {
  const [editing, setEditing] = useState(false);
  const [unlinking, setUnlinking] = useState(null);
  const section = useRef(null);
  const restoreTarget = useRef(null);
  const debt = isDebt(account);
  const currency = account.currency || "USD";
  const collateral = account.collateral;
  const asset =
    collateral && accounts.find((entry) => entry.id === collateral.id);
  const secured = account.secured_debts || [];
  const eligible = accounts.filter(
    (entry) =>
      entry.active !== false &&
      !isDebt(entry) &&
      entry.balance_cents >= 0 &&
      (entry.currency || "USD") === currency,
  );
  useEffect(() => {
    if (busy || !section.current) return;
    const editor = editing
      ? section.current.querySelector(".collateral-form")
      : unlinking
        ? section.current.querySelector(".collateral-unlink-confirmation")
        : null;
    if (editor) {
      if (!editor.contains(document.activeElement))
        editor
          .querySelector(
            "input:not(:disabled), select:not(:disabled), button:not(:disabled)",
          )
          ?.focus();
      return;
    }
    if (!restoreTarget.current) return;
    const selector =
      restoreTarget.current === "unlink"
        ? ".collateral-unlink-trigger:not(:disabled)"
        : ".collateral-link-trigger:not(:disabled)";
    const trigger =
      section.current.querySelector(selector) ||
      section.current.querySelector(
        ".collateral-link-trigger:not(:disabled), .collateral-refresh-trigger:not(:disabled)",
      ) || section.current.closest(".account-drawer")?.querySelector(".account-refresh-trigger:not(:disabled)");
    if (trigger) {
      trigger.focus();
      restoreTarget.current = null;
    }
  }, [editing, unlinking, busy, refreshFailed]);
  if (!debt && !secured.length) return null;
  return (
    <section
      ref={section}
      className="account-collateral"
      aria-labelledby="account-collateral-title"
    >
      <div className="drawer-section-heading">
        <h3 id="account-collateral-title">
          {debt ? "Linked asset" : "Linked debts"}
        </h3>
        {debt && account.active !== false && !editing && !unlinking && (
          <Button
            variant="ghost"
            icon={Link2}
            className="collateral-link-trigger"
            onClick={() => {
              restoreTarget.current = "link";
              setEditing(true);
            }}
            disabled={busy || refreshFailed}
          >
            {collateral ? "Change link" : "Link asset"}
          </Button>
        )}
      </div>
      {debt ? (
        <>
          {collateral ? (
            <>
              <div className="collateral-asset-heading">
                <button
                  type="button"
                  className="collateral-asset-open"
                  onClick={() => onOpenAccount(asset)}
                  disabled={busy || refreshFailed || !asset}
                  aria-label={`Open ${collateral.name} asset details`}
                >
                  <span>
                    <strong>{collateral.name}</strong>
                    <small>
                      {accountKinds[collateral.kind] || "Asset"} ·{" "}
                      {collateral.currency}
                      {collateral.active === false ? " · Archived" : ""}
                    </small>
                  </span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </button>
                <Button
                  variant="ghost"
                  icon={Pencil}
                  onClick={() => onEditAsset(asset)}
                  disabled={busy || refreshFailed || !asset}
                  aria-label={`Edit ${collateral.name} asset value`}
                >
                  Edit value
                </Button>
              </div>
              <EquityValues
                value={collateral.balance_cents}
                debtTotal={collateral.secured_debt_total_cents}
                equity={collateral.equity_cents}
                currency={collateral.currency}
              />
              {!editing && !unlinking && account.active !== false && (
                <Button
                  variant="ghost"
                  icon={Unlink}
                  className="collateral-unlink-trigger"
                  onClick={() => {
                    restoreTarget.current = "unlink";
                    setUnlinking(collateral);
                  }}
                  disabled={busy || refreshFailed}
                >
                  Unlink asset
                </Button>
              )}
            </>
          ) : (
            <p className="drawer-muted">No linked asset.</p>
          )}
          {editing && (
            <CollateralForm
              account={account}
              assets={eligible}
              busy={busy}
              onSave={onSave}
              onCancel={() => setEditing(false)}
            />
          )}
          {unlinking && (
            <div className="collateral-unlink-confirmation">
              <p>
                Unlink {unlinking.name} from {account.name}? The asset and its
                history stay in Accounts.
              </p>
              <div className="drawer-form-actions">
                <Button
                  variant="secondary"
                  onClick={() => setUnlinking(null)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  icon={Unlink}
                  busy={busy}
                  onClick={async () => {
                    if (await onSave({ asset_id: null })) setUnlinking(null);
                  }}
                >
                  Unlink
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <EquityValues
            value={account.balance_cents}
            debtTotal={secured
              .filter(
                (entry) =>
                  entry.active !== false &&
                  entry.net_worth_included !== false &&
                  (entry.currency || "USD") === currency,
              )
              .reduce((sum, entry) => sum + Math.abs(entry.balance_cents), 0)}
            equity={account.equity_cents}
            currency={currency}
          />
          <ul className="collateral-debts">
            {secured.map((entry) => {
              const available = accounts.find(
                (candidate) => candidate.id === entry.id,
              );
              const content = (
                <>
                  <span>
                    <strong>{entry.name}</strong>
                    <small>
                      {entry.active === false
                        ? "Archived"
                        : isPaidOffLoan(entry)
                          ? "Paid off"
                          : debtLabels[entry.debt_type] ||
                            accountKinds[entry.kind]}
                    </small>
                  </span>
                  <span>
                    {money(Math.abs(entry.balance_cents), entry.currency)} owed
                  </span>
                  {available && <ArrowUpRight size={16} aria-hidden="true" />}
                </>
              );
              return (
                <li key={entry.id}>
                  {available ? (
                    <button
                      type="button"
                      onClick={() => onOpenAccount(available)}
                      disabled={busy}
                      aria-label={`Open ${entry.name} debt details`}
                    >
                      {content}
                    </button>
                  ) : (
                    <div>{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          <AlertCircle size={16} />
          {error}
        </p>
      )}
      {refreshFailed && showRefresh && (
        <div className="drawer-form-actions">
          <Button
            variant="secondary"
            className="collateral-refresh-trigger"
            onClick={() => {
              restoreTarget.current = "link";
              onRefresh();
            }}
            busy={busy}
          >
            Refresh accounts
          </Button>
        </div>
      )}
    </section>
  );
}
