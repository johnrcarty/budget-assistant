import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
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
import { findMatchingRule } from "@/lib/rule-match";
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
// Income rules fill SLOTS: numbered income templates ("Natasha 1"/"Natasha
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

    if (rule.lineItemTemplateId) {
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
      name: incomeTemplates.name,
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
  const groupKeyByTemplateId = new Map<string, string>();
  for (const [key, members] of groups) {
    for (const member of members) groupKeyByTemplateId.set(member.id, key);
  }

  // A rule may target a deactivated template (rule outlived the item) -
  // treat it as its own single-slot group, preserving the old behavior.
  const planInputs: SlotPlanInput[] = [];
  for (const match of incomeMatches) {
    let groupKey = groupKeyByTemplateId.get(match.targetTemplateId);
    if (!groupKey) {
      groupKey = `orphan:${match.targetTemplateId}`;
      groups.set(groupKey, [
        { id: match.targetTemplateId, name: groupKey, sortOrder: 0 },
      ]);
      groupKeyByTemplateId.set(match.targetTemplateId, groupKey);
    }
    planInputs.push({ txId: match.txId, month: match.month, groupKey });
  }

  // Occupancy per (group, month): which slot templates already have a
  // transaction linked to their instance this month.
  const occupancy = new Map<string, ReadonlySet<string>>();
  const instanceIdByTemplateMonth = new Map<string, string>();
  const neededPairs = new Set(planInputs.map((p) => `${p.groupKey}|${p.month}`));

  for (const pairKey of neededPairs) {
    const [groupKey, month] = pairKey.split("|");
    const members = groups.get(groupKey) ?? [];
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
