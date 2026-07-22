import { and, asc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  categorizationRules,
  categoryGroups,
  incomeTemplates,
  lineItemTemplates,
} from "@/server/db/schema";

export interface RuleWithTarget {
  rule: typeof categorizationRules.$inferSelect;
  targetLabel: string;
}

export async function getRules(householdId: string): Promise<RuleWithTarget[]> {
  const rows = await db
    .select({
      rule: categorizationRules,
      itemName: lineItemTemplates.name,
      groupName: categoryGroups.name,
      incomeName: incomeTemplates.name,
    })
    .from(categorizationRules)
    .leftJoin(
      lineItemTemplates,
      eq(categorizationRules.lineItemTemplateId, lineItemTemplates.id),
    )
    .leftJoin(categoryGroups, eq(lineItemTemplates.categoryGroupId, categoryGroups.id))
    .leftJoin(incomeTemplates, eq(categorizationRules.incomeTemplateId, incomeTemplates.id))
    .where(eq(categorizationRules.householdId, householdId))
    .orderBy(asc(categorizationRules.priority), asc(categorizationRules.createdAt));

  return rows.map((row) => ({
    rule: row.rule,
    targetLabel: row.incomeName
      ? `Income › ${row.incomeName}`
      : row.groupName && row.itemName
        ? `${row.groupName} › ${row.itemName}`
        : "(deleted target)",
  }));
}

export async function getExpenseTargets(householdId: string) {
  return db
    .select({
      id: lineItemTemplates.id,
      name: lineItemTemplates.name,
      groupName: categoryGroups.name,
    })
    .from(lineItemTemplates)
    .innerJoin(categoryGroups, eq(lineItemTemplates.categoryGroupId, categoryGroups.id))
    .where(
      and(
        eq(lineItemTemplates.householdId, householdId),
        eq(lineItemTemplates.isActive, true),
      ),
    )
    .orderBy(asc(categoryGroups.sortOrder), asc(lineItemTemplates.sortOrder));
}

export async function getIncomeTargets(householdId: string) {
  return db
    .select({ id: incomeTemplates.id, name: incomeTemplates.name })
    .from(incomeTemplates)
    .where(
      and(
        eq(incomeTemplates.householdId, householdId),
        eq(incomeTemplates.isActive, true),
      ),
    )
    .orderBy(asc(incomeTemplates.sortOrder));
}
