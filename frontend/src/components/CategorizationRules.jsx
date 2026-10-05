import { useEffect, useRef, useState } from "react";
import {
  X,
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  SlidersHorizontal,
  LoaderCircle,
  RefreshCw,
  AlertCircle,
  Check,
} from "lucide-react";
import { api } from "../lib/api.js";
import { money, monthLabel, prettyDate } from "../lib/format.js";
import { Button, IconButton } from "./ui.jsx";
import CategorizationRuleForm from "./CategorizationRuleForm.jsx";

const directions = {
  outflow: "Money out",
  inflow: "Money in",
  any: "Either direction",
};
const skipReasons = {
  no_matching_rule: "No matching rule",
  target_missing_in_month: "Budget item not in this month",
  target_category_archived: "Category is archived",
};

export default function CategorizationRules({
  scope,
  month,
  categories,
  accounts,
  initialTransaction,
  onClose,
  onChanged,
  notify,
}) {
  const dialog = useRef(null);
  const mounted = useRef(false);
  const request = useRef(null);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(
    initialTransaction ? { seed: initialTransaction } : null,
  );
  const [deleting, setDeleting] = useState(null);
  const [preview, setPreview] = useState(null);
  const query = `scope=${scope}&month=${month}`;
  const path = "categorization/rules";

  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.current.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.current?.close();
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (editor) dialog.current?.querySelector(".rule-form input")?.focus();
  }, [editor]);
  function focusAddRule() {
    requestAnimationFrame(() => {
      if (mounted.current)
        dialog.current?.querySelector(".rule-list-actions button")?.focus();
    });
  }

  async function loadRules() {
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    setLoading(true);
    try {
      const result = await api(`${path}?${query}`, { signal: abort.signal });
      if (mounted.current && !abort.signal.aborted) setRules(result);
    } catch (failure) {
      if (mounted.current && !abort.signal.aborted) setError(failure.message);
    } finally {
      if (mounted.current && !abort.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    loadRules();
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, [query]);

  async function changeRule(suffix, method, body, message) {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      await api(`${path}${suffix}?${query}`, { method, body });
      if (mounted.current) {
        setEditor(null);
        setDeleting(null);
        await loadRules();
        notify(message);
        if (editor || method === "DELETE") focusAddRule();
      }
    } catch (failure) {
      if (mounted.current) setError(failure.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function moveRule(index, step) {
    const ids = rules.map((rule) => rule.id);
    [ids[index], ids[index + step]] = [ids[index + step], ids[index]];
    changeRule("/reorder", "POST", { rule_ids: ids }, "Rule order updated.");
  }
  async function previewExisting() {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const result = await api(`categorization/preview?scope=${scope}`, {
        method: "POST",
        body: { month },
      });
      if (mounted.current) setPreview(result);
    } catch (failure) {
      if (mounted.current) setError(failure.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function applyPreview() {
    setBusy(true);
    setError("");
    try {
      const result = await api(`categorization/apply?scope=${scope}`, {
        method: "POST",
        body: { preview_token: preview.preview_token },
      });
      if (mounted.current) {
        setPreview(null);
        notify(
          `${result.applied} transaction${result.applied === 1 ? "" : "s"} categorized.`,
        );
        await onChanged();
      }
    } catch (failure) {
      if (mounted.current) {
        setPreview(null);
        setError(
          `${failure.message} Run a fresh preview before applying again.`,
        );
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="item-drawer categorization-drawer"
      aria-labelledby="categorization-title"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget || busy) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <header className="item-drawer-header">
        <div>
          <span className="item-drawer-category">
            <SlidersHorizontal size={16} aria-hidden="true" />
            {scope === "personal" ? "Your private rules" : "Household rules"}
          </span>
          <h2 id="categorization-title">Categorization rules</h2>
          <p className="item-drawer-month">{monthLabel(month)}</p>
        </div>
        <IconButton
          label="Close categorization rules"
          onClick={onClose}
          disabled={busy}
        >
          <X size={21} aria-hidden="true" />
        </IconButton>
      </header>
      <div className="item-drawer-content">
        <section className="item-drawer-section rules-intro">
          <p className="drawer-muted">
            Rules are applied on sync and new transactions. Preview this month
            to categorize other existing uncategorized entries. Manual choices
            stay as they are.
          </p>
          <p className="drawer-muted">
            The first matching active rule wins. Missing or archived items stay
            unresolved.
          </p>
        </section>
        {error && (
          <div className="item-drawer-operation-error" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {editor && (
          <CategorizationRuleForm
            key={editor.rule?.id || "new"}
            rule={editor.rule}
            seed={editor.seed}
            categories={categories}
            accounts={accounts}
            month={month}
            busy={busy}
            onSave={(body) =>
              changeRule(
                editor.rule ? `/${editor.rule.id}` : "",
                editor.rule ? "PATCH" : "POST",
                body,
                editor.rule
                  ? "Rule updated. Existing categories are kept."
                  : "Rule added. Existing categories are kept.",
              )
            }
            onCancel={() => {
              setEditor(null);
              setError("");
              focusAddRule();
            }}
          />
        )}
        <section className="item-drawer-section">
          <div className="drawer-section-heading">
            <h3>Rule order</h3>
            <span>
              {rules.length} rule{rules.length === 1 ? "" : "s"}
            </span>
          </div>
          {loading && !rules.length ? (
            <div className="rules-loading">
              <LoaderCircle size={22} className="spinning" aria-hidden="true" />
              <span>Loading rules…</span>
            </div>
          ) : (
            <>
              <ol className="categorization-rule-list">
                {rules.map((rule, index) => (
                  <li
                    className={`categorization-rule ${!rule.active ? "rule-inactive" : ""}`}
                    key={rule.id}
                  >
                    <div className="rule-summary">
                      <span
                        className="rule-priority"
                        aria-label={`Priority ${index + 1}`}
                      >
                        {index + 1}
                      </span>
                      <div>
                        <strong>{rule.name}</strong>
                        <p>
                          {rule.match_type === "exact" ? "Exact" : "Contains"}:
                          “{rule.merchant_text}”
                        </p>
                        <p>
                          {directions[rule.direction]} ·{" "}
                          {rule.account_name || "Any account"}
                        </p>
                        <span className="rule-target">
                          {rule.target_group_name} → {rule.target_name}
                        </span>
                        {!rule.target_available && (
                          <span className="rule-unavailable">
                            No active item in {monthLabel(month)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="rule-controls">
                      <button
                        type="button"
                        className={`rule-status ${rule.active ? "is-active" : ""}`}
                        onClick={() =>
                          changeRule(
                            `/${rule.id}`,
                            "PATCH",
                            { active: !rule.active },
                            rule.active ? "Rule paused." : "Rule enabled.",
                          )
                        }
                        disabled={busy || !!editor}
                        aria-label={`${rule.active ? "Pause" : "Enable"} ${rule.name}`}
                        aria-pressed={rule.active}
                      >
                        {rule.active ? "Active" : "Paused"}
                      </button>
                      <div>
                        <IconButton
                          label={`Move ${rule.name} up`}
                          onClick={() => moveRule(index, -1)}
                          disabled={busy || !!editor || index === 0}
                        >
                          <ArrowUp size={17} aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          label={`Move ${rule.name} down`}
                          onClick={() => moveRule(index, 1)}
                          disabled={
                            busy || !!editor || index === rules.length - 1
                          }
                        >
                          <ArrowDown size={17} aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          label={`Edit ${rule.name} rule`}
                          onClick={() => {
                            setEditor({ rule });
                            setDeleting(null);
                            setPreview(null);
                            setError("");
                            dialog.current.scrollTo(0, 0);
                          }}
                          disabled={busy || !!editor}
                        >
                          <Pencil size={17} aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          label={`Delete ${rule.name} rule`}
                          onClick={() => {
                            setDeleting(rule.id);
                            setEditor(null);
                            setPreview(null);
                            setError("");
                          }}
                          disabled={busy || !!editor}
                        >
                          <Trash2 size={17} aria-hidden="true" />
                        </IconButton>
                      </div>
                    </div>
                    {deleting === rule.id && (
                      <div className="rule-delete-confirm">
                        <p>
                          Delete this rule? Transactions already categorized by
                          it are kept.
                        </p>
                        <div>
                          <Button
                            variant="secondary"
                            onClick={() => setDeleting(null)}
                            disabled={busy}
                          >
                            Keep rule
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() =>
                              changeRule(
                                `/${rule.id}`,
                                "DELETE",
                                undefined,
                                "Rule removed. Existing categories are kept.",
                              )
                            }
                            busy={busy}
                          >
                            Delete rule
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              {!rules.length && (
                <p className="drawer-muted">
                  Add a merchant rule to give new transactions a purpose
                  automatically.
                </p>
              )}
              <div className="rule-list-actions">
                <Button
                  variant="secondary"
                  icon={Plus}
                  onClick={() => {
                    setEditor({});
                    setDeleting(null);
                    setPreview(null);
                    setError("");
                    dialog.current.scrollTo(0, 0);
                  }}
                  disabled={busy || !!editor}
                >
                  Add rule
                </Button>
                <Button
                  variant="ghost"
                  icon={RefreshCw}
                  onClick={() => {
                    setError("");
                    setPreview(null);
                    loadRules();
                  }}
                  disabled={busy || !!editor}
                >
                  Refresh
                </Button>
              </div>
            </>
          )}
        </section>
        <section className="item-drawer-section rule-preview">
          <div className="drawer-section-heading">
            <h3>Existing transactions</h3>
          </div>
          <p className="drawer-muted">
            Review uncategorized transactions in {monthLabel(month)}. Saving or
            reordering a rule does not change existing categories.
          </p>
          <Button
            variant="secondary"
            icon={SlidersHorizontal}
            onClick={previewExisting}
            busy={busy}
            disabled={loading || !!editor || !!deleting}
          >
            Preview this month
          </Button>
          {editor && (
            <p className="drawer-muted rule-preview-help">
              Save or cancel the rule form before previewing.
            </p>
          )}
          {preview && (
            <div className="rule-preview-result">
              <p className="rule-preview-count" role="status">
                <strong>
                  {preview.counts.matched} match
                  {preview.counts.matched === 1 ? "" : "es"}
                </strong>
                <span>
                  {preview.counts.protected_manual} manual choice
                  {preview.counts.protected_manual === 1 ? "" : "s"} protected
                </span>
              </p>
              <ul className="rule-match-list">
                {preview.matches.map((match) => (
                  <li key={match.transaction_id}>
                    <div>
                      <strong>{match.description}</strong>
                      <small>
                        <time dateTime={match.date}>
                          {prettyDate(match.date)}
                        </time>{" "}
                        · {match.account_name || "Manual entry"}
                      </small>
                      <span>
                        {match.group_name} → {match.item_name}
                      </span>
                      <small>Rule: {match.rule_name}</small>
                    </div>
                    <strong>{money(match.amount_cents)}</strong>
                  </li>
                ))}
              </ul>
              {preview.skipped.length > 0 && (
                <details className="rule-skipped">
                  <summary>
                    {preview.counts.skipped} skipped transaction
                    {preview.counts.skipped === 1 ? "" : "s"}
                  </summary>
                  <ul>
                    {preview.skipped.map((row) => (
                      <li key={row.transaction_id}>
                        <strong>{row.description}</strong>
                        <span>
                          {prettyDate(row.date)} ·{" "}
                          {skipReasons[row.reason] ||
                            "Could not categorize this transaction"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {preview.counts.matched > 0 ? (
                <Button icon={Check} onClick={applyPreview} busy={busy}>
                  Apply {preview.counts.matched} match
                  {preview.counts.matched === 1 ? "" : "es"}
                </Button>
              ) : (
                <p className="drawer-muted">
                  No eligible transactions match these rules.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </dialog>
  );
}
