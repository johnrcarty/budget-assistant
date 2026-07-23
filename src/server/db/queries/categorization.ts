import { and, asc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  accounts,
  categorizationRules,
  categoryGroups,
  incomeTemplates,
  lineItemTemplates,
  persons,
} from "@/server/db/schema";
import { buildSlotGroups } from "@/lib/income-slots";

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
  // one of several paycheck slots - the engine fills the group's next open
  // slot, so the label should say so.
  const activeIncome = await db
    .select({
      id: incomeTemplates.id,
      name: incomeTemplates.name,
      personId: incomeTemplates.personId,
      slotNumber: incomeTemplates.slotNumber,
      sortOrder: incomeTemplates.sortOrder,
      personName: persons.name,
    })
    .from(incomeTemplates)
    .leftJoin(persons, eq(incomeTemplates.personId, persons.id))
    .where(
      and(eq(incomeTemplates.householdId, householdId), eq(incomeTemplates.isActive, true)),
    );
  const slotGroups = buildSlotGroups(activeIncome);
  const groupInfoByTemplateId = new Map<string, { size: number; label: string }>();
  for (const members of slotGroups.values()) {
    const label = members[0].personName ?? members[0].name;
    for (const member of members) groupInfoByTemplateId.set(member.id, { size: members.length, label });
  }

  return rows.map((row) => {
    let targetLabel = "(deleted target)";
    if (row.rule.markAsTransfer) {
      targetLabel = "Transfer between accounts";
    } else if (row.incomeName) {
      const info = row.rule.incomeTemplateId
        ? groupInfoByTemplateId.get(row.rule.incomeTemplateId)
        : undefined;
      targetLabel =
        (info?.size ?? 1) > 1
          ? `Income › ${info!.label} (fills next open check)`
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
      personId: incomeTemplates.personId,
      slotNumber: incomeTemplates.slotNumber,
      sortOrder: incomeTemplates.sortOrder,
      personName: persons.name,
    })
    .from(incomeTemplates)
    .leftJoin(persons, eq(incomeTemplates.personId, persons.id))
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
    name: members[0].personName ?? members[0].name,
    slotCount: members.length,
  }));
}
