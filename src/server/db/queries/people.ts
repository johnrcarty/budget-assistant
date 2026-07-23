import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { persons, accountOwners } from "@/server/db/schema";

export async function getActivePersons(householdId: string) {
  return db
    .select()
    .from(persons)
    .where(and(eq(persons.householdId, householdId), eq(persons.isActive, true)))
    .orderBy(asc(persons.sortOrder), asc(persons.name));
}

export async function getArchivedPersons(householdId: string) {
  return db
    .select()
    .from(persons)
    .where(and(eq(persons.householdId, householdId), eq(persons.isActive, false)))
    .orderBy(asc(persons.name));
}

export async function getPerson(householdId: string, personId: string) {
  const [person] = await db
    .select()
    .from(persons)
    .where(and(eq(persons.id, personId), eq(persons.householdId, householdId)))
    .limit(1);

  return person ?? null;
}

// Owner ids per account, for accounts within one household - batched for the
// accounts list page rather than one query per card.
export async function getOwnersByAccountIds(
  accountIds: string[],
): Promise<Record<string, string[]>> {
  if (accountIds.length === 0) return {};

  const rows = await db
    .select({ accountId: accountOwners.accountId, personId: accountOwners.personId })
    .from(accountOwners)
    .where(inArray(accountOwners.accountId, accountIds));

  const byAccount: Record<string, string[]> = {};
  for (const row of rows) {
    (byAccount[row.accountId] ??= []).push(row.personId);
  }
  return byAccount;
}
