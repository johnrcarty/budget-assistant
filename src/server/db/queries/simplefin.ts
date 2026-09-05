import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  simplefinConnections,
  simplefinConnectionAccounts,
  syncRuns,
  accounts,
} from "@/server/db/schema";

export async function getSimplefinConnection(householdId: string) {
  const [connection] = await db
    .select()
    .from(simplefinConnections)
    .where(
      and(
        eq(simplefinConnections.householdId, householdId),
        ne(simplefinConnections.status, "revoked"),
      ),
    )
    .orderBy(desc(simplefinConnections.createdAt))
    .limit(1);

  return connection ?? null;
}

export async function getConnectionAccounts(connectionId: string) {
  return db
    .select({
      connectionAccount: simplefinConnectionAccounts,
      linkedAccountName: accounts.name,
    })
    .from(simplefinConnectionAccounts)
    .leftJoin(accounts, eq(simplefinConnectionAccounts.accountId, accounts.id))
    .where(eq(simplefinConnectionAccounts.connectionId, connectionId));
}

export async function getLastSyncRun(connectionId: string) {
  const [run] = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.connectionId, connectionId))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);

  return run ?? null;
}

// Local account id -> the sync issue SimpleFin last reported for it, for
// every mapped account in the household. Empty when everything is healthy.
export async function getSyncIssuesByAccountId(
  householdId: string,
): Promise<Record<string, string>> {
  const rows = await db
    .select({
      accountId: simplefinConnectionAccounts.accountId,
      syncIssue: simplefinConnectionAccounts.syncIssue,
    })
    .from(simplefinConnectionAccounts)
    .where(
      and(
        eq(simplefinConnectionAccounts.householdId, householdId),
        isNotNull(simplefinConnectionAccounts.accountId),
        isNotNull(simplefinConnectionAccounts.syncIssue),
      ),
    );
  const byAccount: Record<string, string> = {};
  for (const row of rows) {
    if (row.accountId && row.syncIssue) byAccount[row.accountId] = row.syncIssue;
  }
  return byAccount;
}
