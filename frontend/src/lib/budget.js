const byName = new Intl.Collator("en", { sensitivity: "base" });

export function budgetDueDates(item) {
  if (item.managed && item.payment_dates?.length) {
    return [...item.payment_dates].sort();
  }
  return item.due_date ? [item.due_date] : [];
}

export function sortBudgetItems(items) {
  return [...items].sort((first, second) => {
    const firstDate = budgetDueDates(first)[0];
    const secondDate = budgetDueDates(second)[0];
    if (firstDate && secondDate && firstDate !== secondDate) {
      return firstDate.localeCompare(secondDate);
    }
    if (Boolean(firstDate) !== Boolean(secondDate)) return firstDate ? -1 : 1;
    return byName.compare(first.name, second.name) || first.id - second.id;
  });
}
