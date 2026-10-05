import {
  Plus,
  Pencil,
  Leaf,
  Copy,
  Archive,
  ArchiveRestore,
  ChevronDown,
  CreditCard,
  PiggyBank,
} from "lucide-react";
import { money, monthLabel, prettyDate, colors } from "../lib/format.js";
import { budgetDueDates, sortBudgetItems } from "../lib/budget.js";
import { IconButton, Button, Progress } from "../components/ui.jsx";
import IncomeSection from "../components/IncomeSection.jsx";

function CategoryCard({ category, index, busy, open, openItemDetails }) {
  const items = sortBudgetItems(category.items || []);
  const color = category.color || colors[index % colors.length];
  const saved = category.source === "saved";
  const archived = category.active === false && !saved;
  const managed = category.managed === true && !saved;
  return (
    <section className={`card budget-group ${archived ? "is-archived" : ""}`}>
      <div className="group-heading">
        <div>
          <span
            className="group-symbol"
            style={{ background: `${color}18`, color }}
            aria-hidden="true"
          >
            {saved ? (
              <PiggyBank size={19} />
            ) : managed ? (
              <CreditCard size={19} />
            ) : (
              <Leaf size={19} />
            )}
          </span>
          {managed ? (
            <div className="managed-category-title">
              <h2>{category.name}</h2>
              <span className="managed-category-label">Account-managed</span>
            </div>
          ) : (
            <h2>{category.name}</h2>
          )}
          <span className="item-count">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="group-total">
          <strong>{money(category.spent_cents)}</strong>
          <span>of {money(category.planned_cents)} planned</span>
        </div>
      </div>
      {items.length > 0 && (
        <>
          <Progress
            value={category.spent_cents}
            total={category.planned_cents}
            color={color}
          />
          <div className="budget-column-head budget-ledger-head">
            <span>Item</span>
            <span>Planned</span>
            <span>Actual</span>
            <span>Remaining</span>
          </div>
          {items.map((item) => {
            const dueDates = budgetDueDates(item);
            return (
              <button
                type="button"
                className="budget-item budget-row"
                key={item.id}
                aria-label={`View ${item.name} item details, planned ${money(item.planned_cents)}, actual ${money(item.spent_cents)}, remaining ${money(item.planned_cents - item.spent_cents)}${dueDates.length ? `, due ${dueDates.map(prettyDate).join(", ")}` : ""}`}
                onClick={() =>
                  openItemDetails({
                    ...item,
                    budget_category_id: category.id,
                    group_name: category.name,
                    color,
                  })
                }
                disabled={busy}
              >
                <span className="budget-row-name">
                  <span className="item-line" style={{ background: color }} />
                  <span className="budget-item-name">
                    <strong>{item.name}</strong>
                    {dueDates.length > 0 ? (
                      <small
                        className="budget-item-dates"
                        title={`Due ${dueDates.map(prettyDate).join(", ")}`}
                      >
                        Due{" "}
                        {dueDates.map((date, index) => (
                          <span key={`${date}-${index}`}>
                            {index > 0 ? ", " : ""}
                            <time dateTime={date}>{prettyDate(date)}</time>
                          </span>
                        ))}
                      </small>
                    ) : item.managed ? (
                      <small className="budget-item-dates">
                        No payments this month
                      </small>
                    ) : null}
                  </span>
                </span>
                <span className="budget-row-amount">
                  <small className="budget-amount-label" aria-hidden="true">
                    Planned
                  </small>
                  <span>{money(item.planned_cents)}</span>
                </span>
                <span className="budget-row-amount">
                  <small className="budget-amount-label" aria-hidden="true">
                    Actual
                  </small>
                  <span>{money(item.spent_cents)}</span>
                </span>
                <span
                  className={`budget-row-amount ${
                    item.planned_cents - item.spent_cents < 0
                      ? "amount-negative"
                      : "amount-positive"
                  }`}
                >
                  <small className="budget-amount-label" aria-hidden="true">
                    Remaining
                  </small>
                  <span>{money(item.planned_cents - item.spent_cents)}</span>
                </span>
              </button>
            );
          })}
        </>
      )}
      {(category.historical_item_spent_cents || 0) !== 0 && (
        <p className="category-history-note">
          Includes {money(category.historical_item_spent_cents)} in net spending
          on items planned in other months.
        </p>
      )}
      {managed ? (
        <p className="managed-category-note">
          Payment amounts and dates come from Accounts and are included once in
          this plan. Open an item to link transactions or confirm each payment.
        </p>
      ) : (
        <div className="category-footer">
          {archived ? (
            <Button
              variant="ghost"
              icon={ArchiveRestore}
              onClick={() => open("category-restore", category)}
              disabled={busy}
            >
              Reactivate
            </Button>
          ) : (
            <button
              type="button"
              className="group-add"
              onClick={() => open("item", { budget_category_id: category.id })}
              aria-label={`Add item to ${category.name}`}
              disabled={busy}
            >
              <Plus size={16} aria-hidden="true" />
              Add item
            </button>
          )}
          {!saved && (
            <div className="category-actions">
              <IconButton
                label={`Edit ${category.name} category`}
                onClick={() => open("category", category)}
                disabled={busy}
              >
                <Pencil size={16} />
              </IconButton>
              {!archived && (
                <IconButton
                  label={`Archive ${category.name} category`}
                  onClick={() => open("category-archive", category)}
                  disabled={busy}
                >
                  <Archive size={16} />
                </IconButton>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function Budget({
  scope,
  dash,
  income,
  resetIncome,
  categories = [],
  month,
  busy,
  open,
  openItemDetails,
  openTransactionReceipt,
}) {
  const saved = categories.filter((category) => category.source === "saved");
  const active = categories.filter(
    (category) =>
      category.source !== "saved" &&
      category.active !== false &&
      !category.managed,
  );
  const archived = categories.filter(
    (category) =>
      category.source !== "saved" &&
      category.active === false &&
      !category.managed,
  );
  const managed = categories.filter(
    (category) => category.managed && category.source !== "saved",
  );
  return (
    <>
      <div className="budget-summary">
        <div>
          <p className="eyebrow">
            INCOME FOR {monthLabel(month).toUpperCase()}
          </p>
          <strong className="income-value">{money(dash.income_cents)}</strong>
        </div>
        <div
          className={`unassigned ${(dash.unassigned_cents || 0) < 0 ? "negative" : ""}`}
        >
          <strong>{money(dash.unassigned_cents)}</strong>
          <span>
            {(dash.unassigned_cents || 0) >= 0
              ? "left to give a purpose"
              : "planned above income"}
          </span>
        </div>
        <div className="budget-summary-actions">
          <Button variant="secondary" onClick={() => open("copy")} icon={Copy}>
            Copy a month
          </Button>
        </div>
      </div>
      <IncomeSection
        income={income}
        month={month}
        shared={scope === "household" ? dash.shared_personal : null}
        busy={busy}
        onAdd={() => open("income")}
        onEditEntry={(entry) => open("income-entry", entry)}
        onRemoveEntry={(entry) =>
          open("income-delete", { ...entry, kind: "entry" })
        }
        onEditSource={(source) => open("income-source", source)}
        onStopSource={(source) =>
          open("income-delete", { ...source, kind: "source" })
        }
        onResetEntry={resetIncome}
        onRestoreSkipped={(source) => open("income-restore", source)}
        onOpenTransaction={openTransactionReceipt}
      />
      <div className="budget-groups">
        {saved.map((category, index) => (
          <CategoryCard
            key={category.id}
            category={category}
            index={index}
            busy={busy}
            open={open}
            openItemDetails={openItemDetails}
          />
        ))}
        {active.map((category, index) => (
          <CategoryCard
            key={category.id}
            category={category}
            index={index}
            busy={busy}
            open={open}
            openItemDetails={openItemDetails}
          />
        ))}
        {archived.length > 0 && (
          <details
            className="archived-categories"
            key={`archived-${month}-${scope}`}
            open={archived.some(
              (category) =>
                category.items?.length > 0 || (category.spent_cents || 0) !== 0,
            )}
          >
            <summary>
              <Archive size={17} aria-hidden="true" />
              <span>
                Archived categories <small>{archived.length}</small>
              </span>
              <ChevronDown size={17} aria-hidden="true" />
            </summary>
            <p>
              Items and transactions are kept and still count in this month’s
              totals.
            </p>
            <div className="archived-category-list">
              {archived.map((category, index) => (
                <CategoryCard
                  key={category.id}
                  category={category}
                  index={index}
                  busy={busy}
                  open={open}
                  openItemDetails={openItemDetails}
                />
              ))}
            </div>
          </details>
        )}
        {managed.map((category, index) => (
          <CategoryCard
            key={category.id}
            category={category}
            index={index}
            busy={busy}
            open={open}
            openItemDetails={openItemDetails}
          />
        ))}
        <button
          type="button"
          className="category-add"
          onClick={() => open("category")}
          disabled={busy}
        >
          <Plus size={18} aria-hidden="true" />
          Add category
        </button>
      </div>
    </>
  );
}
