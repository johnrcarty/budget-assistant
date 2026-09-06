import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  simplefinConnections,
  simplefinConnectionAccounts,
  syncRuns,
  accounts,
  transactions,
  transactionExclusions,
  debtBalanceSnapshots,
  accountBalanceSnapshots,
} from "@/server/db/schema";
import { decryptSecret } from "@/server/lib/crypto/secret-box";
import { getSimplefinAccounts, SimplefinRequestError } from "@/server/lib/simplefin/client";
import { dollarsToCents } from "@/server/lib/money";
import {
  applyRulesToUncategorized,
  getActiveRules,
  reapplySignRules,
} from "@/server/lib/categorize";
import { hasSignAction, resolveSignedAmount } from "@/lib/rule-match";

const DAY_SECONDS = 24 * 60 * 60;
// First-ever sync for a connection: a day short of the protocol's actual
// 90-day cap - avoids tripping the "date range exceeds limit" notice from
// clock skew/rounding at the boundary.
const LOOKBACK_SECONDS = 89 * DAY_SECONDS;
// Every later sync: never ask for more than SimpleFin's recommended 45
// days. Asking for more makes the bridge slow enough to time out behind
// Cloudflare (524) - that's what stalled syncing in Sept 2026 when one
// institution needing re-auth had quietly stretched the window past 45
// days - and SimpleFin warns the range "may be capped in the future".
export const MAX_WINDOW_SECONDS = 45 * DAY_SECONDS;
const OVERLAP_SECONDS = 3 * DAY_SECONDS;

// The bridge reports an institution as "MBR-<uuid>" in errlist but tags
// its accounts "MX-MBR-<uuid>" (aggregator-prefixed), so an exact compare
// never matches. Treat them as the same connection when one id ends with
// the other.
export function connIdsMatch(a: string, b: string): boolean {
  return a === b || a.endsWith(b) || b.endsWith(a);
}

// Start of the transaction window for this run, in epoch seconds. Based on
// the last run that actually reached SimpleFin (success or partial), NOT on
// per-account lastSyncedAt: an account whose institution is broken drops
// out of the feed, its timestamp freezes, and a min() over accounts would
// widen the window a day at a time forever (see MAX_WINDOW_SECONDS).
export function computeWindowStart(
  lastReachedAt: Date | null,
  nowSeconds = Math.floor(Date.now() / 1000),
): number {
  if (!lastReachedAt) return nowSeconds - LOOKBACK_SECONDS;
  const fromLastRun = Math.floor(lastReachedAt.getTime() / 1000) - OVERLAP_SECONDS;
  return Math.max(fromLastRun, nowSeconds - MAX_WINDOW_SECONDS);
}

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

    // 3-day overlap catches pending->posted transitions; first-ever sync for
    // this connection uses the full 90-day max the protocol allows.
    const [lastReached] = await db
      .select({ startedAt: syncRuns.startedAt })
      .from(syncRuns)
      .where(and(eq(syncRuns.connectionId, connection.id), ne(syncRuns.status, "error")))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);
    const startDate = computeWindowStart(lastReached?.startedAt ?? null);

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

    // Which institution/account each errlist entry is about, so the issue
    // can be pinned to the affected accounts (and cleared from the rest).
    const issueByConnId = new Map<string, string>();
    const issueByAccountId = new Map<string, string>();
    for (const e of response.errlist) {
      const msg = `${e.code}: ${e.msg}`;
      if (e.conn_id) issueByConnId.set(e.conn_id, msg);
      if (e.account_id) issueByAccountId.set(e.account_id, msg);
    }
    const issueFor = (simplefinAccountId: string, connId: string | null | undefined) => {
      const byAccount = issueByAccountId.get(simplefinAccountId);
      if (byAccount) return byAccount;
      if (!connId) return null;
      for (const [errConnId, msg] of issueByConnId) {
        if (connIdsMatch(connId, errConnId)) return msg;
      }
      return null;
    };

    // Accounts missing from this response whose institution is in the
    // errlist: a broken institution's accounts typically vanish from the
    // feed, so this is the only way to flag them.
    const returnedIds = new Set(response.accounts.map((a) => a.id));
    for (const ca of connAccounts) {
      if (returnedIds.has(ca.simplefinAccountId)) continue;
      const issue = issueFor(ca.simplefinAccountId, ca.simplefinConnId);
      if (issue !== ca.syncIssue) {
        await db
          .update(simplefinConnectionAccounts)
          .set({ syncIssue: issue })
          .where(eq(simplefinConnectionAccounts.id, ca.id));
      }
    }

    // Sign-correction rules, loaded once for the whole connection. Ordered by
    // priority already; resolveSignedAmount ignores rules without a sign action.
    const signRules = (await getActiveRules(connection.householdId)).filter(hasSignAction);

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

      const syncIssue = issueFor(simplefinAccount.id, simplefinAccount.conn_id);
      if (existingConnAccount) {
        await db
          .update(simplefinConnectionAccounts)
          .set({
            simplefinAccountName: simplefinAccount.name,
            lastSyncedBalanceCents: balanceCents,
            lastSyncedAt: new Date(),
            simplefinConnId: simplefinAccount.conn_id ?? existingConnAccount.simplefinConnId,
            syncIssue,
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
          simplefinConnId: simplefinAccount.conn_id ?? null,
          syncIssue,
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

      // Feed ids the user has deleted - re-importing them would undo the
      // deletion, since SimpleFin keeps returning a transaction for as long
      // as it stays inside the lookback window.
      const exclusionRows = await db
        .select({ externalId: transactionExclusions.externalId })
        .from(transactionExclusions)
        .where(
          and(
            eq(transactionExclusions.accountId, linkedAccountId),
            eq(transactionExclusions.source, "simplefin"),
          ),
        );
      const excludedIds = new Set(exclusionRows.map((row) => row.externalId));

      for (const txn of simplefinAccount.transactions ?? []) {
        if (excludedIds.has(txn.id)) continue;
        // Same theme as the liability-balance normalization above: some feeds
        // don't share our sign convention. Fidelity has reported deposit-class
        // inflows as negative, and (since 2026-07-27) debit-card purchases as
        // positive, while signing other rows correctly - so the correction
        // has to be per-description, not per-account. Applying it here
        // rather than post-insert keeps it idempotent - the amount is
        // re-derived from txn.amount on every sync, including through the
        // upsert below. Rows outside the sync window are covered by
        // reapplySignRules after the loop.
        const rawCents = dollarsToCents(txn.amount);
        const amountCents = resolveSignedAmount(
          rawCents,
          {
            description: txn.description,
            accountId: linkedAccountId,
            amountCents: rawCents,
          },
          signRules,
        );
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

    // Rows older than this run's window never come back through the upsert
    // above, so a sign rule added after the fact (or a feed that changes its
    // convention mid-history, as Fidelity did) is applied to stored rows
    // from their raw payload here. Idempotent and cheap.
    await reapplySignRules(connection.householdId);

    // Auto-categorize newly synced (and any backlogged) transactions via
    // the household's categorization rules. Idempotent.
    await applyRulesToUncategorized(connection.householdId);

    // Reaching SimpleFin at all (success or partial) means the Access URL
    // works, so a connection parked in "error" by an earlier rejected
    // request rejoins the scheduled sweep here - this is the recovery path
    // for "Sync now" after a reconnect. A clean run also supersedes
    // whatever the last one complained about.
    await db
      .update(simplefinConnections)
      .set(status === "success" ? { status: "active", lastError: null } : { status: "active" })
      .where(eq(simplefinConnections.id, connection.id));
  } catch (error) {
    status = "error";
    errorDetail = error instanceof Error ? error.message : String(error);
    // Only a rejected credential takes the connection out of the scheduled
    // sweep - that genuinely needs the user to reconnect. A transient
    // failure (bridge 5xx, Cloudflare timeout, network) is recorded and
    // left "active" so the next sweep simply tries again; flipping it to
    // "error" here used to stop all future syncs after one bad request.
    const needsReconnect =
      error instanceof SimplefinRequestError ? error.needsReconnect : false;
    await db
      .update(simplefinConnections)
      .set(needsReconnect ? { status: "error", lastError: errorDetail } : { lastError: errorDetail })
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
