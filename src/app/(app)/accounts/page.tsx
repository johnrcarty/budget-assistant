import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { getCurrentHousehold } from "@/server/lib/dal";
import { getAccounts } from "@/server/db/queries/accounts";
import { formatCents } from "@/server/lib/money";
import { AppHeader } from "@/components/layout/AppHeader";
import { AddAccountDialog } from "@/components/accounts/AddAccountDialog";
import { archiveAccount } from "@/server/actions/accounts";
import { Card, CardContent } from "@/components/ui/card";

const KIND_LABELS: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  cash: "Cash",
  credit_card: "Credit Card",
  loan: "Loan",
  line_of_credit: "Line of Credit",
  other: "Other",
  investment: "Investment",
  crypto: "Crypto",
};

export default async function AccountsPage() {
  const householdId = await getCurrentHousehold();
  const accounts = await getAccounts(householdId);

  return (
    <div>
      <AppHeader
        title="Accounts"
        rightAction={
          <div className="flex items-center gap-4">
            <Link href="/settings/simplefin" aria-label="Bank sync settings">
              <RefreshCw className="size-5" />
            </Link>
            <AddAccountDialog />
          </div>
        }
      />

      <div className="p-4">
        {accounts.length === 0 ? (
          <p className="pt-8 text-center text-muted-foreground">
            No accounts yet — tap + above to add one.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {accounts.map((account) => (
              <Card key={account.id}>
                <CardContent className="flex items-center justify-between">
                  {account.isLiability ? (
                    <Link href={`/accounts/${account.id}`}>
                      <div className="font-medium">{account.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {KIND_LABELS[account.kind] ?? account.kind}
                      </div>
                    </Link>
                  ) : (
                    <div>
                      <div className="font-medium">{account.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {KIND_LABELS[account.kind] ?? account.kind}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <div
                      className={`font-medium ${account.isLiability ? "text-destructive" : ""}`}
                    >
                      {formatCents(account.currentBalanceCents ?? 0)}
                    </div>
                    <form action={archiveAccount.bind(null, account.id)}>
                      <button
                        type="submit"
                        className="text-xs text-muted-foreground hover:text-destructive"
                      >
                        Archive
                      </button>
                    </form>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
