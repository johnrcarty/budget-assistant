import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { getCurrentHousehold } from "@/server/lib/dal";
import { getAccounts, getArchivedAccounts } from "@/server/db/queries/accounts";
import { getBalanceTrends, type BalanceTrends } from "@/server/db/queries/balance-trends";
import { formatCents, formatCentsCompact } from "@/server/lib/money";
import { AppHeader } from "@/components/layout/AppHeader";
import { AddAccountDialog } from "@/components/accounts/AddAccountDialog";
import { EditAccountDialog } from "@/components/accounts/EditAccountDialog";
import { TrendDialog } from "@/components/accounts/TrendDialog";
import { KIND_LABELS } from "@/components/accounts/account-kinds";
import { unarchiveAccount } from "@/server/actions/accounts";
import { Card, CardContent } from "@/components/ui/card";

type Account = Awaited<ReturnType<typeof getAccounts>>[number];

export default async function AccountsPage() {
  const householdId = await getCurrentHousehold();
  const [accounts, archived, trends] = await Promise.all([
    getAccounts(householdId),
    getArchivedAccounts(householdId),
    getBalanceTrends(householdId),
  ]);

  const assets = accounts.filter((a) => !a.isLiability);
  const liabilities = accounts.filter((a) => a.isLiability);
  const netWorthCents = trends.netWorthSeries[trends.netWorthSeries.length - 1];

  // Equity per secured asset: its value minus every liability linked to it
  // (mortgage + HELOC on one house both subtract). Entries whose asset
  // isn't in the active assets list (archived, dangling) are dropped.
  const equityByAsset = new Map<string, { equityCents: number; liabilityNames: string[] }>();
  for (const liability of liabilities) {
    if (!liability.securedAssetAccountId) continue;
    const entry = equityByAsset.get(liability.securedAssetAccountId) ?? {
      equityCents: 0,
      liabilityNames: [],
    };
    entry.equityCents -= liability.currentBalanceCents ?? 0;
    entry.liabilityNames.push(liability.name);
    equityByAsset.set(liability.securedAssetAccountId, entry);
  }
  for (const [assetId, entry] of equityByAsset) {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) {
      equityByAsset.delete(assetId);
      continue;
    }
    entry.equityCents += asset.currentBalanceCents ?? 0;
  }

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

        {accounts.length > 0 && (
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Net Worth
            </h2>
            <TrendDialog
              title="Net Worth"
              points={trends.points}
              series={trends.netWorthSeries}
              trigger={
                <span className="text-lg font-semibold">{formatCents(netWorthCents)}</span>
              }
            />
          </div>
        )}

        {assets.length > 0 && (
          <AccountSection
            title="Assets"
            totalCents={assets.reduce((sum, a) => sum + (a.currentBalanceCents ?? 0), 0)}
            totalSeries={trends.assetsSeries}
            accounts={assets}
            trends={trends}
            equityByAsset={equityByAsset}
          />
        )}

        {liabilities.length > 0 && (
          <AccountSection
            title="Liabilities"
            totalCents={liabilities.reduce((sum, a) => sum + (a.currentBalanceCents ?? 0), 0)}
            totalSeries={trends.liabilitiesSeries}
            accounts={liabilities}
            trends={trends}
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
  totalSeries,
  accounts,
  trends,
  equityByAsset,
  isLiability = false,
}: {
  title: string;
  totalCents: number;
  totalSeries: number[];
  accounts: Account[];
  trends: BalanceTrends;
  equityByAsset?: Map<string, { equityCents: number; liabilityNames: string[] }>;
  isLiability?: boolean;
}) {
  const seriesByAccount = new Map(trends.accounts.map((t) => [t.accountId, t.series]));

  return (
    <section>
      <div className="flex items-baseline justify-between pb-2">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h2>
        <TrendDialog
          title={title}
          points={trends.points}
          series={totalSeries}
          isLiability={isLiability}
          trigger={
            <span className={`font-semibold ${isLiability ? "text-destructive" : ""}`}>
              {formatCents(totalCents)}
            </span>
          }
        />
      </div>
      <div className="flex flex-col gap-3">
        {accounts.map((account) => {
          const equity = equityByAsset?.get(account.id);
          return (
          <Card key={account.id}>
            <CardContent className="flex items-center justify-between gap-3">
              <EditAccountDialog
                account={{
                  id: account.id,
                  name: account.name,
                  kind: account.kind,
                  isLiability: account.isLiability,
                  isManual: account.isManual,
                  currentBalanceCents: account.currentBalanceCents,
                  originalBalanceCents: account.originalBalanceCents,
                }}
                triggerClassName="min-w-0 flex-1 text-left"
                trigger={
                  <div>
                    <div className="truncate font-medium">{account.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {KIND_LABELS[account.kind] ?? account.kind}
                    </div>
                    {equity && (
                      <div
                        className={`truncate text-sm ${
                          equity.equityCents < 0
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {formatCentsCompact(equity.equityCents)} equity ·{" "}
                        {equity.liabilityNames.join(", ")}
                      </div>
                    )}
                  </div>
                }
              />
              <TrendDialog
                title={account.name}
                points={trends.points}
                series={seriesByAccount.get(account.id) ?? trends.points.map(() => 0)}
                isLiability={account.isLiability}
                triggerClassName="shrink-0"
                trigger={
                  <span
                    className={`font-medium ${account.isLiability ? "text-destructive" : ""}`}
                  >
                    {formatCents(account.currentBalanceCents ?? 0)}
                  </span>
                }
              />
            </CardContent>
          </Card>
          );
        })}
      </div>
    </section>
  );
}
