import { and, asc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  accounts,
  categorizationRules,
  categoryGroups,
  incomeTemplates,
  lineItemTemplates,
} from "@/server/db/schema";
import { buildSlotGroups, incomeSlotGroupLabel } from "@/lib/income-slots";

export interface RuleWithTarget {
  rule: typeof categorizationRules.$inferSelect;
  targetLabel: string;
  accountName: string | null;
}

export async function getRules(householdId: string): Promise<RuleWithTarget[]> {
  const rows = await db
    .select({
      rule: categorizationRules,
      itemName: lineItemTemplates.name,
      groupName: categoryGroups.name,
      incomeName: incomeTemplates.name,
      accountName: accounts.name,
    })
    .from(categorizationRules)
    .leftJoin(
      lineItemTemplates,
      eq(categorizationRules.lineItemTemplateId, lineItemTemplates.id),
    )
    .leftJoin(categoryGroups, eq(lineItemTemplates.categoryGroupId, categoryGroups.id))
    .leftJoin(incomeTemplates, eq(categorizationRules.incomeTemplateId, incomeTemplates.id))
    .leftJoin(accounts, eq(categorizationRules.accountId, accounts.id))
    .where(eq(categorizationRules.householdId, householdId))
    .orderBy(asc(categorizationRules.priority), asc(categorizationRules.createdAt));

  // Income targets display as their slot GROUP when the target template is
  // one of several numbered paycheck slots - the engine fills the group's
  // next open slot, so the label should say so.
  const activeIncome = await db
    .select({
      id: incomeTemplates.id,
      name: incomeTemplates.name,
      sortOrder: incomeTemplates.sortOrder,
    })
    .from(incomeTemplates)
    .where(
      and(eq(incomeTemplates.householdId, householdId), eq(incomeTemplates.isActive, true)),
    );
  const slotGroups = buildSlotGroups(activeIncome);
  const groupSizeByTemplateId = new Map<string, number>();
  for (const members of slotGroups.values()) {
    for (const member of members) groupSizeByTemplateId.set(member.id, members.length);
  }

  return rows.map((row) => {
    let targetLabel = "(deleted target)";
    if (row.incomeName) {
      const groupSize = row.rule.incomeTemplateId
        ? (groupSizeByTemplateId.get(row.rule.incomeTemplateId) ?? 1)
        : 1;
      targetLabel =
        groupSize > 1
          ? `Income › ${incomeSlotGroupLabel(row.incomeName)} (fills next open check)`
          : `Income › ${row.incomeName}`;
    } else if (row.groupName && row.itemName) {
      targetLabel = `${row.groupName} › ${row.itemName}`;
    }
    return { rule: row.rule, targetLabel, accountName: row.accountName };
  });
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

// One target per slot GROUP - a rule stores the group's first template id
// and the engine fills the next open slot among the group's members.
export async function getIncomeTargets(
  householdId: string,
): Promise<{ id: string; name: string; slotCount: number }[]> {
  const templates = await db
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
    )
    .orderBy(asc(incomeTemplates.sortOrder));

  const groups = buildSlotGroups(templates);
  return [...groups.values()].map((members) => ({
    id: members[0].id,
    name: incomeSlotGroupLabel(members[0].name),
    slotCount: members.length,
  }));
}
