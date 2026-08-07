import { notFound, redirect } from "next/navigation";
import { getCurrentHousehold } from "@/server/lib/dal";
import { materializeDebtLineItem } from "@/server/db/queries/line-item-instances";

// Debt rows in the budget are projected, not stamped (see
// getProjectedDebtItems), so a projected row has no budget_line_item to link
// to. Opening one lands here: the instance is created on demand and the user
// continues to the ordinary detail page.
//
// Safe as a GET: it's an explicit user tap, and materializing is idempotent -
// an existing instance is returned rather than duplicated. Budget navigation
// uses plain anchors (see components/layout/ingress), so nothing prefetches
// this.
export default async function MaterializeDebtItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { templateId } = await params;
  const { month } = await searchParams;
  if (!month) notFound();

  const householdId = await getCurrentHousehold();
  const lineItemId = await materializeDebtLineItem(householdId, templateId, month);
  if (!lineItemId) notFound();

  redirect(`/budget/item/${lineItemId}`);
}
