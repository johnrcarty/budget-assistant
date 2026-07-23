import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  budgetLineItems,
  incomeLineItems,
  incomeTemplates,
  lineItemTemplates,
  transactions,
} from "@/server/db/schema";
import { getOrCreateBudgetMonth } from "@/server/db/queries/budget";
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
//
// Kept in its own module (not queries/transactions.ts or server/lib/
// categorize.ts) specifically to avoid a circular import: queries/budget.ts
// already imports from queries/transactions.ts, so transactions.ts can't
// import from anything that imports queries/budget.ts without a cycle -
// this module does, both categorize.ts and queries/transactions.ts import
// from here instead of each other.

export async function ensureLineItemInstance(
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

export async function ensureIncomeInstance(
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

// Expands each income target to its slot group, loads current occupancy per
// (group, month), plans assignments in order, and writes the links. Shared
// by the automatic rules engine (categorize.ts) and manual
// categorization (actions/transactions.ts) so both fill slots identically.
export async function applyIncomeSlotAssignments(
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

  // A rule (or a manual pick) may target a deactivated template (rule
  // outlived the item) - treat it as its own single-slot group, preserving
  // the old behavior. buildSlotGroups never sees it (the query above
  // filters isActive=true), so it can't already be in the map above.
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
