import { Field } from "./ui.jsx";

export function itemCategoriesFor(categories, item) {
  return categories.filter(
    (category) =>
      !category.managed &&
      (category.active !== false ||
        (item?.id && category.id === item.budget_category_id)),
  );
}

export default function BudgetItemFields({ item, categories = [] }) {
  const choices = itemCategoriesFor(categories, item);
  const current = categories.find(
    (category) => category.id === item?.budget_category_id,
  );
  const selected = choices.some(
    (category) => category.id === item?.budget_category_id,
  )
    ? item.budget_category_id
    : choices[0]?.id || "";

  return (
    <>
      <Field label="Item name">
        <input
          name="name"
          required
          maxLength={120}
          defaultValue={item?.name || ""}
          placeholder="Groceries, weekend adventures…"
        />
      </Field>
      <div className="form-grid">
        <Field
          label="Category"
          help={
            current?.active === false && item?.id
              ? "This category is archived. Keep the item here or move it to an active category."
              : !choices.length
                ? "Add or reactivate a category before adding an item."
                : undefined
          }
        >
          <select name="budget_category_id" required defaultValue={selected}>
            {!choices.length && <option value="">No active categories</option>}
            {choices.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.active === false ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Planned amount">
          <div className="money-input">
            <span>$</span>
            <input
              name="amount"
              required
              type="number"
              min="0"
              max="10000000000"
              step="0.01"
              defaultValue={
                item?.planned_cents !== undefined
                  ? (item.planned_cents / 100).toFixed(2)
                  : ""
              }
              placeholder="0.00"
            />
          </div>
        </Field>
      </div>
    </>
  );
}
