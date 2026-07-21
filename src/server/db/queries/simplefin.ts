import { and, desc, eq, ne } from "drizzle-orm";
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
