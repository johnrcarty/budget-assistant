import { and, eq, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  simplefinConnections,
  simplefinConnectionAccounts,
  syncRuns,
  accounts,
  transactions,
  debtBalanceSnapshots,
  accountBalanceSnapshots,
} from "@/server/db/schema";
import { decryptSecret } from "@/server/lib/crypto/secret-box";
import { getSimplefinAccounts } from "@/server/lib/simplefin/client";
import { dollarsToCents } from "@/server/lib/money";
import { applyRulesToUncategorized } from "@/server/lib/categorize";

// A day short of the protocol's actual 90-day cap - avoids tripping the
// "date range exceeds limit" notice from clock skew/rounding at the boundary.
const LOOKBACK_SECONDS = 89 * 24 * 60 * 60;
const OVERLAP_SECONDS = 3 * 24 * 60 * 60;

export async function runSimplefinSync(connectionId?: string) {
  // A specific connectionId means "the user explicitly asked for this" (Sync
  // now, or the post-mapping backfill) - run it regardless of stored status,
  // since that's exactly how a previously-erroring connection recovers. Only
  // the unscoped scheduled sweep (the cron worker syncing everything) limits
  // itself to connections already known to be active.
  const whereClause = connectionId
    ? and(
        eq(simplefinConnections.id, connectionId),
        ne(simplefinConnections.status, "revoked"),
      )
    : eq(simplefinConnections.status, "active");

  const connections = await db
    .select()
    .from(simplefinConnections)
    .where(whereClause);

  // Sequential, not parallel - conservative against SimpleFin's shared daily
  // request quota (~24/day across all endpoints).
  for (const connection of connections) {
    await syncConnection(connection);
  }
}

async function syncConnection(connection: typeof simplefinConnections.$inferSelect) {
  const startedAt = new Date();
  let accountsSynced = 0;
  let transactionsImported = 0;
  let status: "success" | "partial" | "error" = "success";
  let errorDetail: string | null = null;

  try {
    const accessUrl = decryptSecret({
      ciphertext: connection.accessUrlCiphertext,
      iv: connection.accessUrlIv,
      authTag: connection.accessUrlAuthTag,
    });

    const connAccounts = await db
      .select()
      .from(simplefinConnectionAccounts)
      .where(eq(simplefinConnectionAccounts.connectionId, connection.id));

    const oldestLastSync = connAccounts.reduce<number | null>((min, ca) => {
      if (!ca.lastSyncedAt) return min;
      const seconds = Math.floor(ca.lastSyncedAt.getTime() / 1000);
      return min === null ? seconds : Math.min(min, seconds);
    }, null);

    const nowSeconds = Math.floor(Date.now() / 1000);
    // 3-day overlap catches pending->posted transitions; first-ever sync for
    // this connection uses the full 90-day max the protocol allows.
    const startDate =
      oldestLastSync !== null
        ? oldestLastSync - OVERLAP_SECONDS
        : nowSeconds - LOOKBACK_SECONDS;

    const response = await getSimplefinAccounts(accessUrl, { startDate, pending: true });

    if (response.errlist.length > 0) {
      status = "partial";
      errorDetail = response.errlist.map((e) => `${e.code}: ${e.msg}`).join("; ");

      // Surfaced for visibility but deliberately doesn't flip the
      // connection's own status to "error": a single Access URL aggregates
      // several institutions (e.g. Chase + a mortgage servicer + a
      // brokerage), and one of them needing re-auth (con.auth) shouldn't
      // stop syncing the others - and critically, an "error" connection
      // status is excluded from the scheduled sweep below, so flipping it
      // here would silently stop future syncs entirely, not just flag the
      // one broken institution. Only a genuine request-level failure
      // (network/decrypt/HTTP error, in the catch block) means the whole
      // connection needs reconnecting.
      await db
        .update(simplefinConnections)
        .set({ lastError: errorDetail })
        .where(eq(simplefinConnections.id, connection.id));
    }

    for (const simplefinAccount of response.accounts) {
      accountsSynced += 1;
      const balanceCents = dollarsToCents(simplefinAccount.balance);

      const [existingConnAccount] = await db
        .select()
        .from(simplefinConnectionAccounts)
        .where(
          and(
            eq(simplefinConnectionAccounts.connectionId, connection.id),
            eq(simplefinConnectionAccounts.simplefinAccountId, simplefinAccount.id),
          ),
        )
        .limit(1);

      if (existingConnAccount) {
        await db
          .update(simplefinConnectionAccounts)
          .set({
            simplefinAccountName: simplefinAccount.name,
            lastSyncedBalanceCents: balanceCents,
            lastSyncedAt: new Date(),
          })
          .where(eq(simplefinConnectionAccounts.id, existingConnAccount.id));
      } else {
        await db.insert(simplefinConnectionAccounts).values({
          connectionId: connection.id,
          householdId: connection.householdId,
          simplefinAccountId: simplefinAccount.id,
          simplefinAccountName: simplefinAccount.name,
          lastSyncedBalanceCents: balanceCents,
          lastSyncedAt: new Date(),
        });
      }

      // Unmapped accounts (no local account chosen yet in the mapping UI)
      // just get their SimpleFin-side balance cached above; nothing else to
      // do until the user maps them.
      const linkedAccountId = existingConnAccount?.accountId ?? null;
      if (!linkedAccountId) continue;

      const [localAccount] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.id, linkedAccountId))
        .limit(1);
      if (!localAccount) continue;

      // SimpleFin reports liability balances as negative (money owed is a
      // negative number from the account's own point of view), but our
      // convention throughout - accounts.currentBalanceCents for a liability
      // and every debtBalanceSnapshots row - is "always positive = amount
      // owed" (matches how a user naturally types "$500" when they mean
      // "I owe $500", and what the payoff math below assumes). Asset
      // accounts keep SimpleFin's sign as-is.
      const normalizedBalanceCents = localAccount.isLiability
        ? Math.abs(balanceCents)
        : balanceCents;

      await db
        .update(accounts)
        .set({ currentBalanceCents: normalizedBalanceCents, balanceAsOf: new Date() })
        .where(eq(accounts.id, linkedAccountId));

      // Every synced account gets a general balance snapshot - this is the
      // only balance history that exists for accounts without transactions
      // (investments, savings), which is what powers their trend lines.
      const balanceAsOfDate = new Date(simplefinAccount["balance-date"] * 1000)
        .toISOString()
        .slice(0, 10);
      await db
        .insert(accountBalanceSnapshots)
        .values({
          accountId: linkedAccountId,
          asOfDate: balanceAsOfDate,
          balanceCents: normalizedBalanceCents,
          source: "simplefin",
        })
        .onConflictDoUpdate({
          target: [
            accountBalanceSnapshots.accountId,
            accountBalanceSnapshots.asOfDate,
            accountBalanceSnapshots.source,
          ],
          set: { balanceCents: normalizedBalanceCents },
        });

      if (localAccount.isLiability) {
        await db
          .insert(debtBalanceSnapshots)
          .values({
            accountId: linkedAccountId,
            asOfDate: balanceAsOfDate,
            balanceCents: normalizedBalanceCents,
            source: "simplefin",
          })
          .onConflictDoUpdate({
            target: [
              debtBalanceSnapshots.accountId,
              debtBalanceSnapshots.asOfDate,
              debtBalanceSnapshots.source,
            ],
            set: { balanceCents: normalizedBalanceCents },
          });
      }

      for (const txn of simplefinAccount.transactions ?? []) {
        const amountCents = dollarsToCents(txn.amount);
        const pending = txn.pending ?? false;
        // Pending transactions haven't posted yet, so the protocol sends
        // posted: 0 for them (which is unix epoch, not "no date") - fall
        // back to transacted_at (when initiated), then today, rather than
        // storing 1970-01-01.
        const effectiveTimestamp =
          txn.posted > 0 ? txn.posted : (txn.transacted_at ?? Math.floor(Date.now() / 1000));
        const postedDate = new Date(effectiveTimestamp * 1000).toISOString().slice(0, 10);

        await db
          .insert(transactions)
          .values({
            householdId: connection.householdId,
            accountId: linkedAccountId,
            amountCents,
            description: txn.description,
            postedDate,
            pending,
            source: "simplefin",
            externalId: txn.id,
            simplefinAccountRef: simplefinAccount.id,
            rawPayload: txn,
          })
          .onConflictDoUpdate({
            target: [transactions.accountId, transactions.source, transactions.externalId],
            set: {
              amountCents,
              description: txn.description,
              postedDate,
              pending,
              rawPayload: txn,
              updatedAt: new Date(),
            },
          });
        transactionsImported += 1;
      }
    }

    // Auto-categorize newly synced (and any backlogged) transactions via
    // the household's categorization rules. Idempotent.
    await applyRulesToUncategorized(connection.householdId);
  } catch (error) {
    status = "error";
    errorDetail = error instanceof Error ? error.message : String(error);
    await db
      .update(simplefinConnections)
      .set({ status: "error", lastError: errorDetail })
      .where(eq(simplefinConnections.id, connection.id));
  }

  await db.insert(syncRuns).values({
    connectionId: connection.id,
    startedAt,
    finishedAt: new Date(),
    status,
    accountsSynced,
    transactionsImported,
    errorDetail,
  });
}
