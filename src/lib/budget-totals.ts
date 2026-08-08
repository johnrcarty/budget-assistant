// Total spent for a budget month, summed across every group's items. The
// overview query doesn't return this directly, so the few places that need
// it share this helper instead of re-deriving it inline.
export function sumSpentCents(
  groups: { items: { spentCents: number }[] }[],
): number {
  return groups
    .flatMap((group) => group.items)
    .reduce((sum, item) => sum + item.spentCents, 0);
}
