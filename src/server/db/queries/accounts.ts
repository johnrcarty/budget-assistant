import { and, asc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { accounts } from "@/server/db/schema";

export async function getAccounts(householdId: string) {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.isArchived, false)))
    .orderBy(asc(accounts.createdAt));
}

export async function getAccount(householdId: string, accountId: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
    .limit(1);

  return account ?? null;
}

export async function getArchivedAccounts(householdId: string) {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.isArchived, true)))
    .orderBy(asc(accounts.createdAt));
}
