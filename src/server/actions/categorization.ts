"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import { categorizationRules } from "@/server/db/schema";
import { getCurrentHousehold } from "@/server/lib/dal";
import {
  applyRulesToUncategorized,
  type ApplyRulesResult,
} from "@/server/lib/categorize";
import {
  suggestCategorizations,
  type AiSuggestion,
} from "@/server/lib/ai-categorize";

const ruleSchema = z.object({
  pattern: z.string().trim().min(2).max(120),
  matchType: z.enum(["contains", "starts_with", "exact"]),
  // "expense:<templateId>" or "income:<templateId>"
  target: z.string().regex(/^(expense|income):[0-9a-f-]{36}$/),
});

export async function createRule(formData: FormData) {
  const householdId = await getCurrentHousehold();
  const input = ruleSchema.parse({
    pattern: formData.get("pattern"),
    matchType: formData.get("matchType") ?? "contains",
    target: formData.get("target"),
  });
  const [kind, templateId] = input.target.split(":");

  await db.insert(categorizationRules).values({
    householdId,
    pattern: input.pattern,
    matchType: input.matchType,
    lineItemTemplateId: kind === "expense" ? templateId : null,
    incomeTemplateId: kind === "income" ? templateId : null,
  });

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

  await db.insert(categorizationRules).values(
    accepted.map((item) => ({
      householdId,
      pattern: item.pattern,
      matchType: "contains" as const,
      lineItemTemplateId: item.kind === "expense" ? item.templateId : null,
      incomeTemplateId: item.kind === "income" ? item.templateId : null,
    })),
  );

  const result = await applyRulesToUncategorized(householdId);
  revalidatePath("/transactions/categorize");
  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/summary");
  return { rulesCreated: accepted.length, matched: result.matched };
}
