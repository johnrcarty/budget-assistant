import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  accounts,
  transactions,
  debtBalanceSnapshots,
  accountBalanceSnapshots,
} from "@/server/db/schema";

export interface AccountTrend {
  accountId: string;
  name: string;
  isLiability: boolean;
  // One value per point, in the display convention used everywhere else:
  // liabilities positive = amount owed.
  series: number[];
}

export interface BalanceTrends {
  // ISO dates: the trailing 12 month-ends plus today, oldest first.
  points: string[];
  accounts: AccountTrend[];
  assetsSeries: number[];
  liabilitiesSeries: number[]; // positive = owed
  netWorthSeries: number[]; // assets - liabilities, may be negative
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

// Trailing month-end dates plus today, oldest first. Month-ends (not
// month-starts) so each historical point means "where things stood after
// that whole month".
function buildPoints(monthsBack: number): string[] {
  const now = new Date();
  const points: string[] = [];
  for (let i = monthsBack; i >= 1; i--) {
    // Day 0 of month (m - i + 1) = last day of month (m - i).
    points.push(toIsoDate(new Date(now.getFullYear(), now.getMonth() - i + 1, 0)));
  }
  points.push(toIsoDate(now));
  return points;
}

// Builds a per-account balance series at each point using the best history
// available, most reliable first:
//
// 1. Accounts with transactions (checking, credit cards): reverse-cumulate
//    from the current balance - balance(p) = balance(now) minus the sum of
//    transactions posted after p. Exact wherever transaction history covers.
// 2. Else, accounts with balance snapshots (mortgage via debt snapshots;
//    401ks/savings via account_balance_snapshot as sync history accrues):
//    most recent snapshot at-or-before each point, carried forward. Points
//    before the first snapshot hold flat at the first known value.
// 3. Else: flat at the current balance - no history exists yet.
//
// The flat cases are honest limits of the data, not bugs: a series only
// starts moving once real history exists for it.
export async function getBalanceTrends(
  householdId: string,
  monthsBack = 12,
): Promise<BalanceTrends> {
  const points = buildPoints(monthsBack);
  const today = points[points.length - 1];
  const firstPoint = points[0];

  const accountList = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.isArchived, false)))
    .orderBy(asc(accounts.name));
  const accountIds = accountList.map((a) => a.id);
  if (accountIds.length === 0) {
    const zeros = points.map(() => 0);
    return {
      points,
      accounts: [],
      assetsSeries: zeros,
      liabilitiesSeries: [...zeros],
      netWorthSeries: [...zeros],
    };
  }

  // Per-account, per-month transaction sums inside the window. Bounded at
  // today so future-dated (pending) rows don't distort the "now" anchor.
  const monthlySums = await db
    .select({
      accountId: transactions.accountId,
      month: sql<string>`to_char(${transactions.postedDate}, 'YYYY-MM')`,
      sumCents: sql<number>`sum(${transactions.amountCents})`,
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.accountId, accountIds),
        gt(transactions.postedDate, firstPoint),
        lte(transactions.postedDate, today),
      ),
    )
    .groupBy(transactions.accountId, sql`to_char(${transactions.postedDate}, 'YYYY-MM')`);

  // Which accounts have any transactions at all (even outside the window) -
  // decides method 1 vs 2/3, so an account that simply had a quiet year
  // still gets the exact transaction-derived (flat) series.
  const txnCounts = await db
    .select({
      accountId: transactions.accountId,
      n: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(inArray(transactions.accountId, accountIds))
    .groupBy(transactions.accountId);
  const hasTxns = new Set(txnCounts.filter((r) => Number(r.n) > 0).map((r) => r.accountId));

  // All snapshots at-or-before today, both tables merged. Both store
  // liabilities positive, same as accounts.currentBalanceCents.
  const [generalSnaps, debtSnaps] = await Promise.all([
    db
      .select({
        accountId: accountBalanceSnapshots.accountId,
        asOfDate: accountBalanceSnapshots.asOfDate,
        balanceCents: accountBalanceSnapshots.balanceCents,
      })
      .from(accountBalanceSnapshots)
      .where(
        and(
          inArray(accountBalanceSnapshots.accountId, accountIds),
          lte(accountBalanceSnapshots.asOfDate, today),
        ),
      )
      .orderBy(asc(accountBalanceSnapshots.asOfDate)),
    db
      .select({
        accountId: debtBalanceSnapshots.accountId,
        asOfDate: debtBalanceSnapshots.asOfDate,
        balanceCents: debtBalanceSnapshots.balanceCents,
      })
      .from(debtBalanceSnapshots)
      .where(
        and(
          inArray(debtBalanceSnapshots.accountId, accountIds),
          lte(debtBalanceSnapshots.asOfDate, today),
        ),
      )
      .orderBy(asc(debtBalanceSnapshots.asOfDate)),
  ]);

  const snapsByAccount = new Map<string, { asOfDate: string; balanceCents: number }[]>();
  for (const snap of [...generalSnaps, ...debtSnaps]) {
    const list = snapsByAccount.get(snap.accountId) ?? [];
    list.push({ asOfDate: snap.asOfDate, balanceCents: Number(snap.balanceCents) });
    snapsByAccount.set(snap.accountId, list);
  }
  for (const list of snapsByAccount.values()) {
    list.sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
  }

  const sumsByAccount = new Map<string, Map<string, number>>();
  for (const row of monthlySums) {
    const byMonth = sumsByAccount.get(row.accountId) ?? new Map<string, number>();
    byMonth.set(row.month, Number(row.sumCents));
    sumsByAccount.set(row.accountId, byMonth);
  }

  const accountTrends: AccountTrend[] = accountList.map((account) => {
    const current = account.currentBalanceCents ?? 0;
    let series: number[];

    if (hasTxns.has(account.id)) {
      // Signed view: assets as-is, liabilities negated - so "balance minus
      // later transactions" walks backward correctly for both (a purchase
      // on a credit card is a negative amount that *raises* the owed
      // balance going forward, i.e. lowers it going backward).
      const signedNow = account.isLiability ? -current : current;
      const byMonth = sumsByAccount.get(account.id) ?? new Map<string, number>();
      // months newest-first, walking the anchor backwards point by point
      const signedSeries: number[] = new Array(points.length);
      signedSeries[points.length - 1] = signedNow;
      let running = signedNow;
      for (let i = points.length - 2; i >= 0; i--) {
        // Transactions strictly after points[i] and <= points[i+1] fall in
        // exactly one calendar month: the month of points[i+1] (points are
        // month-ends plus today, and today >= its own month start).
        const month = points[i + 1].slice(0, 7);
        running -= byMonth.get(month) ?? 0;
        signedSeries[i] = running;
      }
      series = signedSeries.map((v) => (account.isLiability ? -v : v));
    } else {
      const snaps = snapsByAccount.get(account.id) ?? [];
      if (snaps.length > 0) {
        series = points.map((point) => {
          let value = snaps[0].balanceCents; // flat backfill before first snapshot
          for (const snap of snaps) {
            if (snap.asOfDate <= point) value = snap.balanceCents;
            else break;
          }
          return value;
        });
        // The "now" point always reflects the live cached balance.
        series[series.length - 1] = current;
      } else {
        series = points.map(() => current);
      }
    }

    return {
      accountId: account.id,
      name: account.name,
      isLiability: account.isLiability,
      series,
    };
  });

  const assetsSeries = points.map((_, i) =>
    accountTrends.filter((t) => !t.isLiability).reduce((sum, t) => sum + t.series[i], 0),
  );
  const liabilitiesSeries = points.map((_, i) =>
    accountTrends.filter((t) => t.isLiability).reduce((sum, t) => sum + t.series[i], 0),
  );
  const netWorthSeries = points.map((_, i) => assetsSeries[i] - liabilitiesSeries[i]);

  return { points, accounts: accountTrends, assetsSeries, liabilitiesSeries, netWorthSeries };
}
