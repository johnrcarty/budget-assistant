import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  accounts,
  transactions,
  debtBalanceSnapshots,
  accountBalanceSnapshots,
  personNetWorthSnapshots,
} from "@/server/db/schema";
import { getOwnersByAccountIds } from "@/server/db/queries/people";

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export interface AccountBalanceAsOf {
  accountId: string;
  isLiability: boolean;
  // Display convention used everywhere else: liabilities positive = owed.
  balanceCents: number;
}

// Resolves every active account's balance as of one arbitrary date, using
// the same 3-tier method as getBalanceTrends (most reliable first), but for
// a single date instead of a 13-point trailing series - deliberately a
// separate implementation, not a refactor of that function, since its
// month-bucket-walk is an optimization specific to 13 fixed points that
// doesn't generalize cleanly to one arbitrary date, and it's a live,
// frequently-loaded function not worth the risk of touching here.
//
// 1. Has transactions: balance(asOf) = currentBalanceCents minus the sum of
//    transactions posted after asOf (sign-flipped for liabilities, same
//    signed-walk identity as getBalanceTrends).
// 2. No transactions, has snapshots (accountBalanceSnapshots or
//    debtBalanceSnapshots): most recent snapshot at-or-before asOf, else
//    flat-backfill from the earliest snapshot. Unlike getBalanceTrends,
//    there is no "today always uses the live balance" override - that's
//    specific to representing "right now" in a trend series, not a single
//    arbitrary date that may be in the past.
// 3. Neither: flat at currentBalanceCents.
export async function computeAccountBalancesAsOf(
  householdId: string,
  asOfDate: string,
): Promise<AccountBalanceAsOf[]> {
  const today = toIsoDate(new Date());

  const accountList = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.isArchived, false)));
  const accountIds = accountList.map((a) => a.id);
  if (accountIds.length === 0) return [];

  const [sumsAfterAsOf, txnCounts, generalSnaps, debtSnaps] = await Promise.all([
    db
      .select({
        accountId: transactions.accountId,
        sumCents: sql<number>`sum(${transactions.amountCents})`,
      })
      .from(transactions)
      .where(
        and(
          inArray(transactions.accountId, accountIds),
          gt(transactions.postedDate, asOfDate),
          lte(transactions.postedDate, today),
        ),
      )
      .groupBy(transactions.accountId),
    db
      .select({ accountId: transactions.accountId, n: sql<number>`count(*)` })
      .from(transactions)
      .where(inArray(transactions.accountId, accountIds))
      .groupBy(transactions.accountId),
    db
      .select({
        accountId: accountBalanceSnapshots.accountId,
        asOfDate: accountBalanceSnapshots.asOfDate,
        balanceCents: accountBalanceSnapshots.balanceCents,
      })
      .from(accountBalanceSnapshots)
      .where(inArray(accountBalanceSnapshots.accountId, accountIds))
      .orderBy(asc(accountBalanceSnapshots.asOfDate)),
    db
      .select({
        accountId: debtBalanceSnapshots.accountId,
        asOfDate: debtBalanceSnapshots.asOfDate,
        balanceCents: debtBalanceSnapshots.balanceCents,
      })
      .from(debtBalanceSnapshots)
      .where(inArray(debtBalanceSnapshots.accountId, accountIds))
      .orderBy(asc(debtBalanceSnapshots.asOfDate)),
  ]);

  const hasTxns = new Set(txnCounts.filter((r) => Number(r.n) > 0).map((r) => r.accountId));
  const sumAfterByAccount = new Map(sumsAfterAsOf.map((r) => [r.accountId, Number(r.sumCents)]));

  const snapsByAccount = new Map<string, { asOfDate: string; balanceCents: number }[]>();
  for (const snap of [...generalSnaps, ...debtSnaps]) {
    const list = snapsByAccount.get(snap.accountId) ?? [];
    list.push({ asOfDate: snap.asOfDate, balanceCents: Number(snap.balanceCents) });
    snapsByAccount.set(snap.accountId, list);
  }
  for (const list of snapsByAccount.values()) {
    list.sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
  }

  return accountList.map((account) => {
    const current = account.currentBalanceCents ?? 0;
    let balanceCents: number;

    if (hasTxns.has(account.id)) {
      const signedNow = account.isLiability ? -current : current;
      const signedAsOf = signedNow - (sumAfterByAccount.get(account.id) ?? 0);
      balanceCents = account.isLiability ? -signedAsOf : signedAsOf;
    } else {
      const snaps = snapsByAccount.get(account.id) ?? [];
      if (snaps.length > 0) {
        let value = snaps[0].balanceCents; // flat backfill before first snapshot
        for (const snap of snaps) {
          if (snap.asOfDate <= asOfDate) value = snap.balanceCents;
          else break;
        }
        balanceCents = value;
      } else {
        balanceCents = current;
      }
    }

    return { accountId: account.id, isLiability: account.isLiability, balanceCents };
  });
}

export interface PersonNetWorth {
  personId: string;
  assetsCents: number;
  liabilitiesCents: number;
}

// Splits each account's resolved balance evenly across its current owners
// (0 owners -> excluded entirely; 1 -> that owner gets 100%; 2+ -> each
// gets balanceCents / ownerCount, rounded independently per owner - a
// display feature, not a ledger, so a joint account's split doesn't need
// to reconcile to the cent). Computed off accountOwners directly rather
// than filtering to active persons first, so an archived person who still
// owns an account keeps accruing history. A person who owns zero accounts
// produces no row, matching the sparse/append-only convention used
// elsewhere - not a synthesized zero.
export async function computePersonNetWorth(
  householdId: string,
  asOfDate: string,
): Promise<PersonNetWorth[]> {
  const balances = await computeAccountBalancesAsOf(householdId, asOfDate);
  if (balances.length === 0) return [];

  const ownersByAccount = await getOwnersByAccountIds(balances.map((b) => b.accountId));

  const totals = new Map<string, { assetsCents: number; liabilitiesCents: number }>();
  for (const account of balances) {
    const owners = ownersByAccount[account.accountId] ?? [];
    if (owners.length === 0) continue;
    const share = Math.round(account.balanceCents / owners.length);
    for (const personId of owners) {
      const entry = totals.get(personId) ?? { assetsCents: 0, liabilitiesCents: 0 };
      if (account.isLiability) entry.liabilitiesCents += share;
      else entry.assetsCents += share;
      totals.set(personId, entry);
    }
  }

  return [...totals.entries()].map(([personId, entry]) => ({ personId, ...entry }));
}

export async function getPersonNetWorthHistory(householdId: string, personId: string) {
  return db
    .select({
      asOfDate: personNetWorthSnapshots.asOfDate,
      assetsCents: personNetWorthSnapshots.assetsCents,
      liabilitiesCents: personNetWorthSnapshots.liabilitiesCents,
    })
    .from(personNetWorthSnapshots)
    .where(
      and(
        eq(personNetWorthSnapshots.householdId, householdId),
        eq(personNetWorthSnapshots.personId, personId),
      ),
    )
    .orderBy(asc(personNetWorthSnapshots.asOfDate));
}

export interface PersonNetWorthPoint {
  asOfDate: string;
  assetsCents: number;
  liabilitiesCents: number;
}

// Batched full-history lookup for a list of persons (e.g. the People
// settings page listing everyone at once) - one query, not N+1. The People
// page derives each person's "latest" figure as the last entry (rows arrive
// oldest-first) and only needs the full array to decide whether there's
// enough history to show a trend chart.
export async function getNetWorthHistoryByPersonIds(
  householdId: string,
  personIds: string[],
): Promise<Record<string, PersonNetWorthPoint[]>> {
  if (personIds.length === 0) return {};

  const rows = await db
    .select({
      personId: personNetWorthSnapshots.personId,
      asOfDate: personNetWorthSnapshots.asOfDate,
      assetsCents: personNetWorthSnapshots.assetsCents,
      liabilitiesCents: personNetWorthSnapshots.liabilitiesCents,
    })
    .from(personNetWorthSnapshots)
    .where(
      and(
        eq(personNetWorthSnapshots.householdId, householdId),
        inArray(personNetWorthSnapshots.personId, personIds),
      ),
    )
    .orderBy(asc(personNetWorthSnapshots.asOfDate));

  const history: Record<string, PersonNetWorthPoint[]> = {};
  for (const row of rows) {
    (history[row.personId] ??= []).push(row);
  }
  return history;
}
