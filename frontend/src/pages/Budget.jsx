import { Wallet, Plus, Pencil, Trash2, Leaf, Copy } from "lucide-react";
import { money, monthLabel, colors } from "../lib/format.js";
import { IconButton, Button, Empty, Progress } from "../components/ui.jsx";
import IncomeSection from "../components/IncomeSection.jsx";
export default function Budget({
  scope,
  dash,
  income,
  resetIncome,
  groups,
  month,
  busy,
  open,
  deleteItem,
}) {
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
          <Button onClick={() => open("item")} icon={Plus}>
            Add budget item
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
        {groups.map((g, i) => (
          <section className="card budget-group" key={g.id || g.name}>
            <div className="group-heading">
              <div>
                <span
                  className="group-symbol"
                  style={{
                    background: `${g.color || colors[i % colors.length]}18`,
                    color: g.color || colors[i % colors.length],
                  }}
                >
                  <Leaf size={19} />
                </span>
                <h2>{g.name}</h2>
                <span className="item-count">{g.items.length} items</span>
              </div>
              <div className="group-total">
                <strong>{money(g.spent_cents)}</strong>
                <span>of {money(g.planned_cents)} planned</span>
              </div>
            </div>
            <Progress
              value={g.spent_cents}
              total={g.planned_cents}
              color={g.color || colors[i % colors.length]}
            />
            <div className="budget-column-head">
              <span>PURPOSE</span>
              <span>PLANNED</span>
              <span>SPENT</span>
              <span>REMAINING</span>
              <span />
            </div>
            {g.items.map((item) => (
              <div className="budget-item" key={item.id}>
                <div>
                  <span
                    className="item-line"
                    style={{
                      background: g.color || colors[i % colors.length],
                    }}
                  />
                  <strong>{item.name}</strong>
                </div>
                <button
                  className="editable-money"
                  onClick={() =>
                    open("item", {
                      ...item,
                      group_name: g.name,
                      color: g.color,
                    })
                  }
                  title={`Edit ${item.name}`}
                >
                  {money(item.planned_cents)}
                  <Pencil size={12} />
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
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
            ))}
            <button
              className="group-add"
              onClick={() =>
                open("item", {
                  group_name: g.name,
                  color: g.color,
                })
              }
            >
              <Plus size={15} />
              Add to {g.name}
            </button>
          </section>
        ))}
      </div>
      {!groups.length && (
        <section className="card">
          <Empty
            title={`A fresh plan for ${monthLabel(month).split(" ")[0]}.`}
            description="Begin with your income, then make room for each purpose. You can also bring last month’s plan along."
            icon={Wallet}
            action={
              <div className="empty-actions">
                <Button onClick={() => open("income")} icon={Plus}>
                  Add named income
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => open("copy")}
                  icon={Copy}
                >
                  Copy last month
                </Button>
              </div>
            }
          />
        </section>
      )}
    </>
  );
}
