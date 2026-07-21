import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { accounts } from "@/server/db/schema";

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Only asset accounts get their cached balance auto-maintained from
// transactions here. Liability accounts' balance is deliberately left alone -
// Phase 5's debt_balance_snapshots is the real source of truth for those,
// and a naive "+= amountCents" would need the opposite sign convention for a
// liability (a purchase increases what you owe), so doing it "for now" would
// just be something to unwind later.
export async function adjustAccountBalance(
  tx: DbTransaction,
  accountId: string,
  deltaCents: number,
) {
  if (deltaCents === 0) return;

  const [account] = await tx
    .select({ isLiability: accounts.isLiability })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);

  if (!account || account.isLiability) return;

  await tx
    .update(accounts)
    .set({
      currentBalanceCents: sql`coalesce(${accounts.currentBalanceCents}, 0) + ${deltaCents}`,
      balanceAsOf: new Date(),
    })
    .where(eq(accounts.id, accountId));
}
