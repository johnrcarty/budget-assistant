import { and, asc, eq, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { categorizationRules, transactions } from "@/server/db/schema";
import {
  ensureLineItemInstance,
  applyIncomeSlotAssignments,
} from "@/server/db/queries/line-item-instances";
import {
  findMatchingRule,
  hasCategorizationTarget,
  transactionMatchesRule,
} from "@/lib/rule-match";

export async function getActiveRules(householdId: string) {
  return db
    .select()
    .from(categorizationRules)
    .where(
      and(
        eq(categorizationRules.householdId, householdId),
        eq(categorizationRules.isActive, true),
      ),
    )
    .orderBy(asc(categorizationRules.priority), asc(categorizationRules.createdAt));
}

export interface ApplyRulesResult {
  matched: number;
  scanned: number;
}

// Links every uncategorized transaction whose description matches an active
// rule. Idempotent - safe to run after every sync/import and on demand.
// Instance lookups are cached per (target, month) so a 2k-row backlog
// doesn't hammer the db.
//
// Income rules fill SLOTS: numbered income templates ("Person A 1"/"Person A
// 2") form a group, and matching deposits land on the earliest slot in the
// transaction's month that has no linked transaction yet (manual
// assignments occupy slots too). When every slot is taken, further deposits
// overflow onto the last slot. That's why transactions are processed in
// posted-date order - the Nth deposit fills the Nth check.
export async function applyRulesToUncategorized(
  householdId: string,
): Promise<ApplyRulesResult> {
  // Action-only rules (e.g. forceInflow sign fixes) have no target and are
  // applied elsewhere - keeping them out of the match list stops them
  // shadowing a lower-priority rule that does categorize.
  const rules = (await getActiveRules(householdId)).filter(hasCategorizationTarget);
  if (rules.length === 0) return { matched: 0, scanned: 0 };

  const uncategorized = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      postedDate: transactions.postedDate,
      amountCents: transactions.amountCents,
      accountId: transactions.accountId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.budgetLineItemId),
        isNull(transactions.incomeLineItemId),
        eq(transactions.isTransfer, false),
      ),
    )
    .orderBy(
      asc(transactions.postedDate),
      asc(transactions.createdAt),
      asc(transactions.id),
    );

  const instanceCache = new Map<string, string | null>();
  let matched = 0;

  // Phase 1: expenses apply inline (unchanged semantics); income matches
  // are collected so slots can be planned with full knowledge of order.
  const incomeMatches: { txId: string; month: string; targetTemplateId: string }[] = [];

  for (const tx of uncategorized) {
    const rule = findMatchingRule(tx, rules);
    if (!rule) continue;

    const month = `${tx.postedDate.slice(0, 7)}-01`;

    if (rule.markAsTransfer) {
      await db
        .update(transactions)
        .set({ isTransfer: true, updatedAt: new Date() })
        .where(eq(transactions.id, tx.id));
      matched += 1;
    } else if (rule.lineItemTemplateId) {
      const cacheKey = `item:${rule.lineItemTemplateId}:${month}`;
      let instanceId = instanceCache.get(cacheKey);
      if (instanceId === undefined) {
        instanceId = await ensureLineItemInstance(householdId, rule.lineItemTemplateId, month);
        instanceCache.set(cacheKey, instanceId);
      }
      if (!instanceId) continue;
      await db
        .update(transactions)
        .set({ budgetLineItemId: instanceId, updatedAt: new Date() })
        .where(eq(transactions.id, tx.id));
      matched += 1;
    } else if (rule.incomeTemplateId) {
      incomeMatches.push({ txId: tx.id, month, targetTemplateId: rule.incomeTemplateId });
    }
  }

  if (incomeMatches.length > 0) {
    matched += await applyIncomeSlotAssignments(householdId, incomeMatches);
  }

  return { matched, scanned: uncategorized.length };
}

// Force-reapplies rules to every transaction matching the given rule's
// pattern/conditions - INCLUDING already-categorized ones - so editing a
// rule's target can move its historical matches in one action. Each
// transaction is re-evaluated against the FULL active rule list (priority
// still wins), so re-applying a broad rule can't steal transactions a more
// specific rule claims. Overwrites manual categorizations on matching
// transactions by design - this is the explicit, per-rule "fix it" button.
export async function applyRuleToMatching(
  householdId: string,
  ruleId: string,
): Promise<ApplyRulesResult> {
  const allRules = await getActiveRules(householdId);
  const rule = allRules.find((r) => r.id === ruleId);
  if (!rule) return { matched: 0, scanned: 0 };
  // Nothing to reapply for an action-only rule: its effect (forceInflow) is
  // applied during sync, not by re-categorizing stored rows.
  if (!hasCategorizationTarget(rule)) return { matched: 0, scanned: 0 };
  const rules = allRules.filter(hasCategorizationTarget);

  // SQL prefilter: a contains-style ilike is a superset of all three match
  // types; the JS matcher below makes the exact decision.
  const escapedPattern = rule.pattern.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const conditions: SQL[] = [
    eq(transactions.householdId, householdId),
    ilike(transactions.description, `%${escapedPattern}%`),
  ];
  if (rule.accountId) conditions.push(eq(transactions.accountId, rule.accountId));
  if (rule.amountCents != null) {
    conditions.push(
      sql`abs(${transactions.amountCents}) = ${Math.abs(rule.amountCents)}`,
    );
  }

  const candidates = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      postedDate: transactions.postedDate,
      amountCents: transactions.amountCents,
      accountId: transactions.accountId,
      budgetLineItemId: transactions.budgetLineItemId,
      incomeLineItemId: transactions.incomeLineItemId,
      isTransfer: transactions.isTransfer,
    })
    .from(transactions)
    .where(and(...conditions))
    .orderBy(
      asc(transactions.postedDate),
      asc(transactions.createdAt),
      asc(transactions.id),
    );
  const matching = candidates.filter((tx) => transactionMatchesRule(tx, rule));

  const instanceCache = new Map<string, string | null>();
  let matched = 0;
  const incomeMatches: { txId: string; month: string; targetTemplateId: string }[] = [];
  const incomeClearIds: string[] = [];

  for (const tx of matching) {
    const winner = findMatchingRule(tx, rules);
    if (!winner) continue;
    const month = `${tx.postedDate.slice(0, 7)}-01`;

    if (winner.markAsTransfer) {
      if (tx.isTransfer && !tx.budgetLineItemId && !tx.incomeLineItemId) continue;
      await db
        .update(transactions)
        .set({
          isTransfer: true,
          budgetLineItemId: null,
          incomeLineItemId: null,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, tx.id));
      matched += 1;
    } else if (winner.lineItemTemplateId) {
      const cacheKey = `item:${winner.lineItemTemplateId}:${month}`;
      let instanceId = instanceCache.get(cacheKey);
      if (instanceId === undefined) {
        instanceId = await ensureLineItemInstance(householdId, winner.lineItemTemplateId, month);
        instanceCache.set(cacheKey, instanceId);
      }
      if (!instanceId) continue;
      if (tx.budgetLineItemId === instanceId && !tx.incomeLineItemId && !tx.isTransfer) {
        continue;
      }
      await db
        .update(transactions)
        .set({
          budgetLineItemId: instanceId,
          incomeLineItemId: null,
          isTransfer: false,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, tx.id));
      matched += 1;
    } else if (winner.incomeTemplateId) {
      incomeMatches.push({ txId: tx.id, month, targetTemplateId: winner.incomeTemplateId });
      if (tx.budgetLineItemId || tx.incomeLineItemId || tx.isTransfer) {
        incomeClearIds.push(tx.id);
      }
    }
  }

  // Unlink re-targeted income transactions first, so slot occupancy is
  // computed without the rows being moved.
  if (incomeClearIds.length > 0) {
    await db
      .update(transactions)
      .set({
        budgetLineItemId: null,
        incomeLineItemId: null,
        isTransfer: false,
        updatedAt: new Date(),
      })
      .where(inArray(transactions.id, incomeClearIds));
  }
  if (incomeMatches.length > 0) {
    matched += await applyIncomeSlotAssignments(householdId, incomeMatches);
  }

  return { matched, scanned: matching.length };
}

