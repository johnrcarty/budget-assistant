import { and, asc, eq, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  budgetLineItems,
  categorizationRules,
  incomeLineItems,
  incomeTemplates,
  lineItemTemplates,
  transactions,
} from "@/server/db/schema";
import { getOrCreateBudgetMonth } from "@/server/db/queries/budget";
import { findMatchingRule, transactionMatchesRule } from "@/lib/rule-match";
import {
  buildSlotGroups,
  planSlotAssignments,
  type SlotPlanInput,
  type SlotTemplate,
} from "@/lib/income-slots";

// Transactions link to per-month INSTANCES (budget_line_item /
// income_line_item), not to templates. Categorizing a transaction from
// month M therefore needs M's instance of the target template - created on
// demand with plannedAmountCents 0 for months that never budgeted it, so
// retroactive categorization doesn't fabricate planned amounts.

async function ensureLineItemInstance(
  householdId: string,
  templateId: string,
  month: string, // YYYY-MM-01
): Promise<string | null> {
  const [template] = await db
    .select()
    .from(lineItemTemplates)
    .where(
      and(
        eq(lineItemTemplates.id, templateId),
        eq(lineItemTemplates.householdId, householdId),
      ),
    )
    .limit(1);
  if (!template) return null;

  const budgetMonth = await getOrCreateBudgetMonth(householdId, month);
  const [existing] = await db
    .select({ id: budgetLineItems.id })
    .from(budgetLineItems)
    .where(
      and(
        eq(budgetLineItems.budgetMonthId, budgetMonth.id),
        eq(budgetLineItems.templateItemId, templateId),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(budgetLineItems)
    .values({
      householdId,
      budgetMonthId: budgetMonth.id,
      categoryGroupId: template.categoryGroupId,
      templateItemId: template.id,
      name: template.name,
      plannedAmountCents: 0,
      sortOrder: template.sortOrder,
    })
    .returning({ id: budgetLineItems.id });
  return created.id;
}

async function ensureIncomeInstance(
  householdId: string,
  incomeTemplateId: string,
  month: string,
): Promise<string | null> {
  const [template] = await db
    .select()
    .from(incomeTemplates)
    .where(
      and(
        eq(incomeTemplates.id, incomeTemplateId),
        eq(incomeTemplates.householdId, householdId),
      ),
    )
    .limit(1);
  if (!template) return null;

  const budgetMonth = await getOrCreateBudgetMonth(householdId, month);
  const [existing] = await db
    .select({ id: incomeLineItems.id })
    .from(incomeLineItems)
    .where(
      and(
        eq(incomeLineItems.budgetMonthId, budgetMonth.id),
        eq(incomeLineItems.templateItemId, incomeTemplateId),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(incomeLineItems)
    .values({
      householdId,
      budgetMonthId: budgetMonth.id,
      templateItemId: template.id,
      name: template.name,
      plannedAmountCents: 0,
      sortOrder: template.sortOrder,
    })
    .returning({ id: incomeLineItems.id });
  return created.id;
}

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
  const rules = await getActiveRules(householdId);
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
  const rules = await getActiveRules(householdId);
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) return { matched: 0, scanned: 0 };

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

// Phase 2 of rule application: expand each income target to its slot group,
// load current occupancy per (group, month), plan assignments in order, and
// write the links.
async function applyIncomeSlotAssignments(
  householdId: string,
  incomeMatches: { txId: string; month: string; targetTemplateId: string }[],
): Promise<number> {
  const activeTemplates: SlotTemplate[] = await db
    .select({
      id: incomeTemplates.id,
      personId: incomeTemplates.personId,
      slotNumber: incomeTemplates.slotNumber,
      sortOrder: incomeTemplates.sortOrder,
    })
    .from(incomeTemplates)
    .where(
      and(
        eq(incomeTemplates.householdId, householdId),
        eq(incomeTemplates.isActive, true),
      ),
    );

  const groups = buildSlotGroups(activeTemplates);
  const slotGroupIdByTemplateId = new Map<string, string>();
  for (const [key, members] of groups) {
    for (const member of members) slotGroupIdByTemplateId.set(member.id, key);
  }

  // A rule may target a deactivated template (rule outlived the item) -
  // treat it as its own single-slot group, preserving the old behavior.
  // buildSlotGroups never sees it (the query above filters isActive=true),
  // so it can't already be in the map above.
  const planInputs: SlotPlanInput[] = [];
  for (const match of incomeMatches) {
    let slotGroupId = slotGroupIdByTemplateId.get(match.targetTemplateId);
    if (!slotGroupId) {
      slotGroupId = `orphan:${match.targetTemplateId}`;
      groups.set(slotGroupId, [
        { id: match.targetTemplateId, personId: null, slotNumber: 1, sortOrder: 0 },
      ]);
      slotGroupIdByTemplateId.set(match.targetTemplateId, slotGroupId);
    }
    planInputs.push({ txId: match.txId, month: match.month, personId: slotGroupId });
  }

  // Occupancy per (group, month): which slot templates already have a
  // transaction linked to their instance this month.
  const occupancy = new Map<string, ReadonlySet<string>>();
  const instanceIdByTemplateMonth = new Map<string, string>();
  const neededPairs = new Set(planInputs.map((p) => `${p.personId}|${p.month}`));

  for (const pairKey of neededPairs) {
    const [slotGroupId, month] = pairKey.split("|");
    const members = groups.get(slotGroupId) ?? [];
    if (members.length === 0) continue;

    const budgetMonth = await getOrCreateBudgetMonth(householdId, month);
    const instances = await db
      .select({ id: incomeLineItems.id, templateItemId: incomeLineItems.templateItemId })
      .from(incomeLineItems)
      .where(
        and(
          eq(incomeLineItems.budgetMonthId, budgetMonth.id),
          inArray(
            incomeLineItems.templateItemId,
            members.map((m) => m.id),
          ),
        ),
      );

    const templateByInstance = new Map<string, string>();
    for (const instance of instances) {
      if (!instance.templateItemId) continue;
      // First row wins per template - duplicates are pre-existing quirks.
      const key = `${instance.templateItemId}|${month}`;
      if (!instanceIdByTemplateMonth.has(key)) {
        instanceIdByTemplateMonth.set(key, instance.id);
        templateByInstance.set(instance.id, instance.templateItemId);
      }
    }

    const occupied = new Set<string>();
    if (templateByInstance.size > 0) {
      const linkCounts = await db
        .select({
          incomeLineItemId: transactions.incomeLineItemId,
          count: sql<number>`count(*)`,
        })
        .from(transactions)
        .where(inArray(transactions.incomeLineItemId, [...templateByInstance.keys()]))
        .groupBy(transactions.incomeLineItemId);
      for (const row of linkCounts) {
        if (!row.incomeLineItemId) continue;
        const templateId = templateByInstance.get(row.incomeLineItemId);
        if (templateId && Number(row.count) > 0) occupied.add(templateId);
      }
    }
    occupancy.set(pairKey, occupied);
  }

  const assignments = planSlotAssignments(planInputs, groups, occupancy);

  let matched = 0;
  for (const assignment of assignments) {
    const key = `${assignment.templateId}|${assignment.month}`;
    let instanceId = instanceIdByTemplateMonth.get(key) ?? null;
    if (!instanceId) {
      instanceId = await ensureIncomeInstance(householdId, assignment.templateId, assignment.month);
      if (instanceId) instanceIdByTemplateMonth.set(key, instanceId);
    }
    if (!instanceId) continue;
    await db
      .update(transactions)
      .set({ incomeLineItemId: instanceId, updatedAt: new Date() })
      .where(eq(transactions.id, assignment.txId));
    matched += 1;
  }
  return matched;
}
