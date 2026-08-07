import { IngressLink } from "@/components/layout/ingress";
import type { UpcomingBill, UpcomingBills } from "@/server/db/queries/budget";
import { formatFullDate } from "@/lib/month";
import { formatCents } from "@/server/lib/money";

export function UpcomingBillsCard({ bills }: { bills: UpcomingBills }) {
  const sections = [
    { title: "Overdue", rows: bills.overdue, titleClass: "text-destructive" },
    { title: "Due today", rows: bills.dueToday, titleClass: "text-foreground" },
    { title: "This week", rows: bills.dueThisWeek, titleClass: "text-muted-foreground" },
  ].filter((section) => section.rows.length > 0);

  return (
    <div className="rounded-xl bg-card p-4 shadow-xs">
      <h2 className="font-semibold">Upcoming bills</h2>
      {sections.length === 0 ? (
        <p className="pt-3 text-sm text-muted-foreground">
          Nothing due in the next 7 days.
        </p>
      ) : (
        sections.map((section) => (
          <div key={section.title} className="pt-3">
            <h3 className={`text-xs font-medium uppercase tracking-wide ${section.titleClass}`}>
              {section.title}
            </h3>
            <div>
              {section.rows.map((bill) => (
                <BillRow key={`${bill.source}:${bill.id}`} bill={bill} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function BillRow({ bill }: { bill: UpcomingBill }) {
  const content = (
    <div className="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{bill.name}</div>
        <div className="text-sm text-muted-foreground">
          {bill.groupName} · {formatFullDate(bill.dueDate)}
        </div>
      </div>
      <div className="shrink-0 whitespace-nowrap font-medium">
        {formatCents(bill.plannedAmountCents)}
      </div>
    </div>
  );

  // Template-projected bills (next month's budget doesn't exist yet) have no
  // line-item page to link to.
  if (bill.source === "template") return content;

  // Projected debt carries a template id, not an instance id - opening it
  // materializes the instance first, same as the budget page's Debt rows.
  const href =
    bill.source === "projected_debt"
      ? `/budget/item/debt/${bill.id}?month=${bill.dueDate.slice(0, 7)}-01`
      : `/budget/item/${bill.id}`;

  return (
    <IngressLink href={href} className="block">
      {content}
    </IngressLink>
  );
}
