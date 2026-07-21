import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { getCurrentHousehold } from "@/server/lib/dal";
import { getAccounts, getArchivedAccounts } from "@/server/db/queries/accounts";
import { formatCents } from "@/server/lib/money";
import { AppHeader } from "@/components/layout/AppHeader";
import { AddAccountDialog } from "@/components/accounts/AddAccountDialog";
import { EditAccountDialog } from "@/components/accounts/EditAccountDialog";
import { KIND_LABELS } from "@/components/accounts/account-kinds";
import { archiveAccount, unarchiveAccount } from "@/server/actions/accounts";
import { Card, CardContent } from "@/components/ui/card";

type Account = Awaited<ReturnType<typeof getAccounts>>[number];

export default async function AccountsPage() {
  const householdId = await getCurrentHousehold();
  const [accounts, archived] = await Promise.all([
    getAccounts(householdId),
    getArchivedAccounts(householdId),
  ]);

  const assets = accounts.filter((a) => !a.isLiability);
  const liabilities = accounts.filter((a) => a.isLiability);

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

      <div className="flex flex-col gap-6 p-4 pt-0">
        {accounts.length === 0 && (
          <p className="pt-8 text-center text-muted-foreground">
            No accounts yet — tap + above to add one.
          </p>
        )}

        {assets.length > 0 && (
          <AccountSection
            title="Assets"
            totalCents={assets.reduce((sum, a) => sum + (a.currentBalanceCents ?? 0), 0)}
            accounts={assets}
          />
        )}

        {liabilities.length > 0 && (
          <AccountSection
            title="Liabilities"
            totalCents={liabilities.reduce((sum, a) => sum + (a.currentBalanceCents ?? 0), 0)}
            accounts={liabilities}
            isLiability
          />
        )}

        {archived.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Archived ({archived.length})
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              {archived.map((account) => (
                <Card key={account.id} className="opacity-70">
                  <CardContent className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{account.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {KIND_LABELS[account.kind] ?? account.kind}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div
                        className={`font-medium ${account.isLiability ? "text-destructive" : ""}`}
                      >
                        {formatCents(account.currentBalanceCents ?? 0)}
                      </div>
                      <form action={unarchiveAccount.bind(null, account.id)}>
                        <button
                          type="submit"
                          className="text-xs text-muted-foreground hover:text-primary"
                        >
                          Unarchive
                        </button>
                      </form>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function AccountSection({
  title,
  totalCents,
  accounts,
  isLiability = false,
}: {
  title: string;
  totalCents: number;
  accounts: Account[];
  isLiability?: boolean;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between pb-2">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h2>
        <span className={`font-semibold ${isLiability ? "text-destructive" : ""}`}>
          {formatCents(totalCents)}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {accounts.map((account) => (
          <Card key={account.id}>
            <CardContent className="flex items-center justify-between gap-3">
              {account.isLiability ? (
                <Link href={`/accounts/${account.id}`} className="min-w-0 flex-1">
                  <div className="truncate font-medium">{account.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {KIND_LABELS[account.kind] ?? account.kind}
                  </div>
                </Link>
              ) : (
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{account.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {KIND_LABELS[account.kind] ?? account.kind}
                  </div>
                </div>
              )}
              <div className="flex shrink-0 items-center gap-3">
                <div className={`font-medium ${account.isLiability ? "text-destructive" : ""}`}>
                  {formatCents(account.currentBalanceCents ?? 0)}
                </div>
                <EditAccountDialog
                  account={{ id: account.id, name: account.name, kind: account.kind }}
                />
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
    </section>
  );
}
