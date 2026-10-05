import {
  Plus,
  Pencil,
  Trash2,
  Leaf,
  Copy,
  Archive,
  ArchiveRestore,
  ChevronDown,
  CreditCard,
  Settings2,
} from "lucide-react";
import { money, monthLabel, prettyDate, colors } from "../lib/format.js";
import { budgetDueDates, sortBudgetItems } from "../lib/budget.js";
import { IconButton, Button, Progress } from "../components/ui.jsx";
import IncomeSection from "../components/IncomeSection.jsx";

function CategoryCard({
  category,
  index,
  busy,
  open,
  openItemDetails,
  openAccountDetails,
  accounts = [],
  deleteItem,
}) {
  const items = sortBudgetItems(category.items || []);
  const color = category.color || colors[index % colors.length];
  const archived = category.active === false;
  const managed = category.managed === true;
  return (
    <section className={`card budget-group ${archived ? "is-archived" : ""}`}>
      <div className="group-heading">
        <div>
          <span
            className="group-symbol"
            style={{ background: `${color}18`, color }}
            aria-hidden="true"
          >
            {managed ? <CreditCard size={19} /> : <Leaf size={19} />}
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
          <div className="budget-column-head">
            <span>ITEM</span>
            <span>PLANNED</span>
            <span>SPENT</span>
            <span>REMAINING</span>
            <span />
          </div>
          {items.map((item) => {
            const dueDates = budgetDueDates(item);
            return (
              <div className="budget-item" key={item.id}>
                <button
                  type="button"
                  className="budget-item-open"
                  aria-label={`View ${item.name} item details${dueDates.length ? `, due ${dueDates.map(prettyDate).join(", ")}` : ""}`}
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
                  <span className="item-line" style={{ background: color }} />
                  <span className="budget-item-name">
                    <strong>{item.name}</strong>
                    {dueDates.length > 0 ? (
                      <small className="budget-item-dates">
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
                </button>
                {item.managed ? (
                  <span className="managed-planned">
                    {money(item.planned_cents)}
                  </span>
                ) : (
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
                )}
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
                {item.managed ? (
                  <IconButton
                    label={`Configure ${item.name} in Accounts`}
                    onClick={() =>
                      openAccountDetails(
                        accounts.find(
                          (account) => account.id === item.managed_account_id,
                        ),
                      )
                    }
                    disabled={
                      busy ||
                      !accounts.some(
                        (account) => account.id === item.managed_account_id,
                      )
                    }
                  >
                    <Settings2 size={16} />
                  </IconButton>
                ) : (
                  <IconButton
                    label={`Delete ${item.name}`}
                    onClick={() => deleteItem("item", item)}
                    disabled={busy}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                )}
              </div>
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
  openAccountDetails,
  accounts,
  deleteItem,
}) {
  const active = categories.filter(
    (category) => category.active !== false && !category.managed,
  );
  const archived = categories.filter(
    (category) => category.active === false && !category.managed,
  );
  const managed = categories.filter((category) => category.managed);
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
            openItemDetails={openItemDetails}
            openAccountDetails={openAccountDetails}
            accounts={accounts}
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
                  openItemDetails={openItemDetails}
                  openAccountDetails={openAccountDetails}
                  accounts={accounts}
                  deleteItem={deleteItem}
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
            openAccountDetails={openAccountDetails}
            accounts={accounts}
            deleteItem={deleteItem}
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
