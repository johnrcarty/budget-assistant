import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { getCurrentHousehold } from "@/server/lib/dal";
import { getAccounts, getArchivedAccounts, getAccountGroups } from "@/server/db/queries/accounts";
import { getBalanceTrends, type BalanceTrends } from "@/server/db/queries/balance-trends";
import { getCurrentAprByAccount } from "@/server/db/queries/debt";
import { getActivePersons, getOwnersByAccountIds } from "@/server/db/queries/people";
import { formatCents, formatCentsCompact } from "@/server/lib/money";
import { AppHeader } from "@/components/layout/AppHeader";
import { AddAccountDialog } from "@/components/accounts/AddAccountDialog";
import { EditAccountDialog } from "@/components/accounts/EditAccountDialog";
import { AccountGroupCard } from "@/components/accounts/AccountGroupCard";
import { TrendDialog } from "@/components/accounts/TrendDialog";
import { KIND_LABELS } from "@/components/accounts/account-kinds";
import { unarchiveAccount } from "@/server/actions/accounts";
import { Card, CardContent } from "@/components/ui/card";

type Account = Awaited<ReturnType<typeof getAccounts>>[number];

export default async function AccountsPage() {
  const householdId = await getCurrentHousehold();
  const [accounts, archived, trends, accountGroupList, persons] = await Promise.all([
    getAccounts(householdId),
    getArchivedAccounts(householdId),
    getBalanceTrends(householdId),
    getAccountGroups(householdId),
    getActivePersons(householdId),
  ]);
  const ownersByAccount = await getOwnersByAccountIds(accounts.map((a) => a.id));

  const assets = accounts.filter((a) => !a.isLiability);
  const liabilities = accounts.filter((a) => a.isLiability);
  const netWorthCents = trends.netWorthSeries[trends.netWorthSeries.length - 1];
  const groupOptions = accountGroupList.map((g) => ({ id: g.id, name: g.name }));
  const personOptions = persons.map((p) => ({ id: p.id, name: p.name }));

  // Weighted-avg APR on group rollups needs each grouped liability's
  // current terms - one batch query for all of them.
  const groupedLiabilityIds = liabilities
    .filter((a) => a.accountGroupId)
    .map((a) => a.id);
  const aprByAccount = await getCurrentAprByAccount(groupedLiabilityIds);

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
            <AddAccountDialog groups={groupOptions} persons={personOptions} />
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
            groups={groupOptions}
            aprByAccount={aprByAccount}
            persons={personOptions}
            ownersByAccount={ownersByAccount}
          />
        )}

        {liabilities.length > 0 && (
          <AccountSection
            title="Liabilities"
            totalCents={liabilities.reduce((sum, a) => sum + (a.currentBalanceCents ?? 0), 0)}
            totalSeries={trends.liabilitiesSeries}
            accounts={liabilities}
            trends={trends}
            groups={groupOptions}
            aprByAccount={aprByAccount}
            persons={personOptions}
            ownersByAccount={ownersByAccount}
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
  groups = [],
  aprByAccount = {},
  persons = [],
  ownersByAccount = {},
  isLiability = false,
}: {
  title: string;
  totalCents: number;
  totalSeries: number[];
  accounts: Account[];
  trends: BalanceTrends;
  equityByAsset?: Map<string, { equityCents: number; liabilityNames: string[] }>;
  groups?: { id: string; name: string }[];
  aprByAccount?: Record<string, number | null>;
  persons?: { id: string; name: string }[];
  ownersByAccount?: Record<string, string[]>;
  isLiability?: boolean;
}) {
  const seriesByAccount = new Map(trends.accounts.map((t) => [t.accountId, t.series]));
  const zeroSeries = trends.points.map(() => 0);

  // Grouped members collapse into one rollup card per group; ungrouped
  // accounts render individually as before. A group only appears in the
  // section(s) its members belong to.
  const ungrouped = accounts.filter((a) => !a.accountGroupId);
  const groupsInSection = groups
    .map((group) => ({
      group,
      members: accounts.filter((a) => a.accountGroupId === group.id),
    }))
    .filter(({ members }) => members.length > 0);

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
        {groupsInSection.map(({ group, members }) => (
          <AccountGroupCard
            key={group.id}
            group={group}
            members={members.map((m) => ({
              id: m.id,
              name: m.name,
              kind: m.kind,
              isLiability: m.isLiability,
              isManual: m.isManual,
              currentBalanceCents: m.currentBalanceCents,
              originalBalanceCents: m.originalBalanceCents,
              accountGroupId: m.accountGroupId,
            }))}
            points={trends.points}
            seriesByMember={Object.fromEntries(
              members.map((m) => [m.id, seriesByAccount.get(m.id) ?? zeroSeries]),
            )}
            summedSeries={trends.points.map((_, i) =>
              members.reduce(
                (sum, m) => sum + (seriesByAccount.get(m.id) ?? zeroSeries)[i],
                0,
              ),
            )}
            aprByAccount={aprByAccount}
            isLiability={isLiability}
            groups={groups}
            persons={persons}
            ownersByAccount={ownersByAccount}
          />
        ))}
        {ungrouped.map((account) => {
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
                  accountGroupId: account.accountGroupId,
                }}
                groups={groups}
                persons={persons}
                ownerIds={ownersByAccount[account.id] ?? []}
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
