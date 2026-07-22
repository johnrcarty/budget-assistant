import { and, asc, eq, isNull } from "drizzle-orm";
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
    );

  const instanceCache = new Map<string, string | null>();
  let matched = 0;

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
      const cacheKey = `income:${rule.incomeTemplateId}:${month}`;
      let instanceId = instanceCache.get(cacheKey);
      if (instanceId === undefined) {
        instanceId = await ensureIncomeInstance(householdId, rule.incomeTemplateId, month);
        instanceCache.set(cacheKey, instanceId);
      }
      if (!instanceId) continue;
      await db
        .update(transactions)
        .set({ incomeLineItemId: instanceId, updatedAt: new Date() })
        .where(eq(transactions.id, tx.id));
      matched += 1;
    }
  }

  return { matched, scanned: uncategorized.length };
}
