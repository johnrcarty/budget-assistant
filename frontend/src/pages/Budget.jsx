import {
  Plus,
  Pencil,
  Trash2,
  Leaf,
  Copy,
  Archive,
  ArchiveRestore,
  ChevronDown,
} from "lucide-react";
import { money, monthLabel, colors } from "../lib/format.js";
import { IconButton, Button, Progress } from "../components/ui.jsx";
import IncomeSection from "../components/IncomeSection.jsx";

function CategoryCard({ category, index, busy, open, deleteItem }) {
  const items = category.items || [];
  const color = category.color || colors[index % colors.length];
  const archived = category.active === false;
  return (
    <section className={`card budget-group ${archived ? "is-archived" : ""}`}>
      <div className="group-heading">
        <div>
          <span
            className="group-symbol"
            style={{ background: `${color}18`, color }}
            aria-hidden="true"
          >
            <Leaf size={19} />
          </span>
          <h2>{category.name}</h2>
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
          <div className="budget-column-head">
            <span>ITEM</span>
            <span>PLANNED</span>
            <span>SPENT</span>
            <span>REMAINING</span>
            <span />
          </div>
          {items.map((item) => (
            <div className="budget-item" key={item.id}>
              <div>
                <span className="item-line" style={{ background: color }} />
                <strong>{item.name}</strong>
              </div>
              <button
                type="button"
                className="editable-money"
                onClick={() =>
                  open("item", { ...item, budget_category_id: category.id })
                }
                aria-label={`Edit ${item.name} item, ${money(item.planned_cents)} planned`}
                disabled={busy}
              >
                {money(item.planned_cents)}
                <Pencil size={12} aria-hidden="true" />
              </button>
              <span>{money(item.spent_cents)}</span>
              <span
                className={
                  item.planned_cents - item.spent_cents < 0
                    ? "amount-negative"
                    : "amount-positive"
                }
              >
                {money(item.planned_cents - item.spent_cents)}
              </span>
              <IconButton
                label={`Delete ${item.name}`}
                onClick={() => deleteItem("item", item)}
                disabled={busy}
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          ))}
        </>
      )}
      {(category.historical_item_spent_cents || 0) !== 0 && (
        <p className="category-history-note">
          Includes {money(category.historical_item_spent_cents)} in net spending
          on items planned in other months.
        </p>
      )}
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
      </div>
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
  deleteItem,
}) {
  const active = categories.filter((category) => category.active !== false);
  const archived = categories.filter((category) => category.active === false);
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
      />
      <div className="budget-groups">
        {active.map((category, index) => (
          <CategoryCard
            key={category.id}
            category={category}
            index={index}
            busy={busy}
            open={open}
            deleteItem={deleteItem}
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
                  deleteItem={deleteItem}
                />
              ))}
            </div>
          </details>
        )}
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
