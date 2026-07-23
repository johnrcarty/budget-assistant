import { db } from "@/server/db/client";
import { personNetWorthSnapshots } from "@/server/db/schema";
import { computePersonNetWorth } from "@/server/db/queries/net-worth-snapshot";

// Request-context-free (no getCurrentHousehold/DAL) so it's directly
// callable from a verification script with an explicit householdId, same
// as the other job-layer functions in this app. Computes each person's
// share of net worth as of the given date and upserts one row per person,
// same shape as addBalanceSnapshot/addAssetValueSnapshot - re-running for
// the same date updates that date's row via the unique
// (personId, asOfDate, source) constraint rather than duplicating.
export async function recordPersonNetWorthSnapshots(
  householdId: string,
  asOfDate: string,
): Promise<void> {
  const totals = await computePersonNetWorth(householdId, asOfDate);

  for (const { personId, assetsCents, liabilitiesCents } of totals) {
    await db
      .insert(personNetWorthSnapshots)
      .values({ householdId, personId, asOfDate, assetsCents, liabilitiesCents, source: "computed" })
      .onConflictDoUpdate({
        target: [
          personNetWorthSnapshots.personId,
          personNetWorthSnapshots.asOfDate,
          personNetWorthSnapshots.source,
        ],
        set: { assetsCents, liabilitiesCents },
      });
  }
}
