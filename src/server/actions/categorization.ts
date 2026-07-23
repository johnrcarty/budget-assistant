"use server";

import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import { categorizationRules, lineItemTemplates, incomeTemplates } from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";
import { dollarsToCents } from "@/server/lib/money";
import {
  applyRulesToUncategorized,
  applyRuleToMatching,
  type ApplyRulesResult,
} from "@/server/lib/categorize";
import {
  suggestCategorizations,
  type AiSuggestion,
} from "@/server/lib/ai-categorize";

const ruleSchema = z.object({
  pattern: z.string().trim().min(2).max(120),
  matchType: z.enum(["contains", "starts_with", "exact"]),
  // "expense:<templateId>", "income:<templateId>", or "transfer"
  target: z.string().regex(/^(transfer|(expense|income):[0-9a-f-]{36})$/),
  accountId: z.uuid().optional(), // extra condition: only this account
  amount: z.string().trim().optional(), // extra condition: exact amount (abs)
  // min 0, not 1: early AI-suggested rules were created with priority 0 and
  // must survive a round-trip through the edit form unchanged.
  priority: z.coerce.number().int().min(0).max(9999),
});

function ruleValues(input: z.infer<typeof ruleSchema>) {
  const [kind, templateId] = input.target.split(":");
  return {
    pattern: input.pattern,
    matchType: input.matchType,
    accountId: input.accountId ?? null,
    amountCents: input.amount ? Math.abs(dollarsToCents(input.amount)) : null,
    priority: input.priority,
    lineItemTemplateId: kind === "expense" ? templateId : null,
    incomeTemplateId: kind === "income" ? templateId : null,
    markAsTransfer: kind === "transfer",
  };
}

// The rule's target template must belong to this household - otherwise a
// tampered target value could point a rule at another household's budget
// or income structure.
async function verifyRuleTarget(
  householdId: string,
  values: { lineItemTemplateId: string | null; incomeTemplateId: string | null },
) {
  if (values.lineItemTemplateId) {
    const [item] = await db
      .select({ id: lineItemTemplates.id })
      .from(lineItemTemplates)
      .where(
        and(
          eq(lineItemTemplates.id, values.lineItemTemplateId),
          eq(lineItemTemplates.householdId, householdId),
        ),
      )
      .limit(1);
    if (!item) throw new Error("Unknown budget line item template");
  }
  if (values.incomeTemplateId) {
    const [item] = await db
      .select({ id: incomeTemplates.id })
      .from(incomeTemplates)
      .where(
        and(
          eq(incomeTemplates.id, values.incomeTemplateId),
          eq(incomeTemplates.householdId, householdId),
        ),
      )
      .limit(1);
    if (!item) throw new Error("Unknown income template");
  }
}

function parseRuleForm(formData: FormData) {
  return ruleSchema.parse({
    pattern: formData.get("pattern"),
    matchType: formData.get("matchType") ?? "contains",
    target: formData.get("target"),
    accountId:
      formData.get("accountId") === "any"
        ? undefined
        : formData.get("accountId") || undefined,
    amount: formData.get("amount") || undefined,
    priority: formData.get("priority") || 100,
  });
}

export async function createRule(formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = parseRuleForm(formData);
  const values = ruleValues(input);
  await verifyRuleTarget(householdId, values);

  await db.insert(categorizationRules).values({
    householdId,
    ...values,
  });

  revalidatePath("/transactions/categorize");
}

export async function updateRule(ruleId: string, formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = parseRuleForm(formData);
  const values = ruleValues(input);
  await verifyRuleTarget(householdId, values);

  await db
    .update(categorizationRules)
    .set(values)
    .where(
      and(
        eq(categorizationRules.id, ruleId),
        eq(categorizationRules.householdId, householdId),
      ),
    );

  revalidatePath("/transactions/categorize");
}

export async function deleteRule(ruleId: string) {
  const householdId = await getCurrentHousehold();
  await db
    .delete(categorizationRules)
    .where(
      and(
        eq(categorizationRules.id, ruleId),
        eq(categorizationRules.householdId, householdId),
      ),
    );
  revalidatePath("/transactions/categorize");
}

export async function runRules(): Promise<ApplyRulesResult> {
  const householdId = await getCurrentHousehold();
  const result = await applyRulesToUncategorized(householdId);
  revalidatePath("/transactions/categorize");
  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/budget/income");
  revalidatePath("/summary");
  return result;
}

// Re-runs rules over every transaction matching this rule's conditions,
// including already-categorized ones - the "my rule changed, fix history"
// button.
export async function reapplyRule(ruleId: string): Promise<ApplyRulesResult> {
  const householdId = await getCurrentHousehold();
  const result = await applyRuleToMatching(householdId, ruleId);
  revalidatePath("/transactions/categorize");
  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/budget/income");
  revalidatePath("/summary");
  return result;
}

export async function getAiSuggestions(): Promise<{
  suggestions: AiSuggestion[];
  remainingMerchants: number;
}> {
  const householdId = await getCurrentHousehold();
  return suggestCategorizations(householdId);
}

const applySchema = z.array(
  z.object({
    pattern: z.string().trim().min(2).max(120),
    kind: z.enum(["expense", "income"]),
    templateId: z.uuid(),
  }),
).min(1).max(100);

// Accepted AI suggestions become ordinary rules, then the rules engine runs
// once - so the same categorization keeps applying to future syncs.
export async function applyAiSuggestions(
  input: z.infer<typeof applySchema>,
): Promise<{ rulesCreated: number; matched: number }> {
  const householdId = await getCurrentHousehold();
  const accepted = applySchema.parse(input);

  const expenseIds = accepted.filter((i) => i.kind === "expense").map((i) => i.templateId);
  const incomeIds = accepted.filter((i) => i.kind === "income").map((i) => i.templateId);
  const [ownedExpense, ownedIncome] = await Promise.all([
    expenseIds.length
      ? db
          .select({ id: lineItemTemplates.id })
          .from(lineItemTemplates)
          .where(
            and(
              inArray(lineItemTemplates.id, expenseIds),
              eq(lineItemTemplates.householdId, householdId),
            ),
          )
      : [],
    incomeIds.length
      ? db
          .select({ id: incomeTemplates.id })
          .from(incomeTemplates)
          .where(
            and(
              inArray(incomeTemplates.id, incomeIds),
              eq(incomeTemplates.householdId, householdId),
            ),
          )
      : [],
  ]);
  const ownedExpenseIds = new Set(ownedExpense.map((i) => i.id));
  const ownedIncomeIds = new Set(ownedIncome.map((i) => i.id));
  if (
    expenseIds.some((id) => !ownedExpenseIds.has(id)) ||
    incomeIds.some((id) => !ownedIncomeIds.has(id))
  ) {
    throw new Error("Unknown template in suggestions");
  }

  await db.insert(categorizationRules).values(
    accepted.map((item) => ({
      householdId,
      pattern: item.pattern,
      matchType: "contains" as const,
      priority: 100, // manual rules with lower priority can override these
      lineItemTemplateId: item.kind === "expense" ? item.templateId : null,
      incomeTemplateId: item.kind === "income" ? item.templateId : null,
    })),
  );

  const result = await applyRulesToUncategorized(householdId);
  revalidatePath("/transactions/categorize");
  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/budget/income");
  revalidatePath("/summary");
  return { rulesCreated: accepted.length, matched: result.matched };
}
