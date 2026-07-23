import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  categoryGroups,
  incomeTemplates,
  lineItemTemplates,
  persons,
  transactions,
} from "@/server/db/schema";
import { getActiveRules } from "./categorize";
import { findMatchingRule, merchantKey, ruleMatches } from "@/lib/rule-match";
import { buildSlotGroups } from "@/lib/income-slots";

// The owner explicitly chose Haiku for this: it's a bulk classification
// task where cost matters more than depth.
const MODEL = "claude-haiku-4-5";
const MAX_MERCHANTS_PER_BATCH = 60;

export interface MerchantGroup {
  key: string;
  sampleDescription: string;
  count: number;
  totalCents: number; // net; negative = mostly spending
}

export interface CategoryOption {
  code: string; // "E1".."En" for expenses, "I1".."In" for income
  kind: "expense" | "income";
  templateId: string;
  label: string; // "Housing › Mortgage Payment" / "Income › Paycheck"
}

export interface AiSuggestion {
  merchant: MerchantGroup;
  option: CategoryOption | null; // null = model said skip
  pattern: string;
  confidence: "high" | "medium" | "low";
}

// Uncategorized transactions grouped by normalized merchant, largest groups
// first, excluding groups an existing active rule already covers (running
// the rules is free - don't spend tokens on them).
export async function getUncategorizedMerchants(
  householdId: string,
): Promise<MerchantGroup[]> {
  const [rows, rules] = await Promise.all([
    db
      .select({
        description: transactions.description,
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
      ),
    getActiveRules(householdId),
  ]);

  const groups = new Map<string, MerchantGroup>();
  for (const row of rows) {
    if (findMatchingRule(row, rules)) continue;
    const key = merchantKey(row.description);
    if (!key) continue;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      group.totalCents += row.amountCents;
    } else {
      groups.set(key, {
        key,
        sampleDescription: row.description,
        count: 1,
        totalCents: row.amountCents,
      });
    }
  }

  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export async function getCategoryOptions(householdId: string): Promise<CategoryOption[]> {
  const [templates, income] = await Promise.all([
    db
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
      .orderBy(asc(categoryGroups.sortOrder), asc(lineItemTemplates.sortOrder)),
    db
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
      .orderBy(asc(incomeTemplates.sortOrder)),
  ]);

  // Income options collapse to one per slot group (a person, not each of
  // their numbered slots) - the engine fills slots in deposit order, so the
  // model can't pick a wrong slot, and the prompt spends fewer tokens.
  const incomeGroups = [...buildSlotGroups(income).values()];

  return [
    ...templates.map((t, i) => ({
      code: `E${i + 1}`,
      kind: "expense" as const,
      templateId: t.id,
      label: `${t.groupName} › ${t.name}`,
    })),
    ...incomeGroups.map((members, i) => ({
      code: `I${i + 1}`,
      kind: "income" as const,
      templateId: members[0].id,
      label: `Income › ${members[0].personName ?? members[0].name}`,
    })),
  ];
}

const ResponseSchema = z.object({
  suggestions: z.array(
    z.object({
      merchant: z.string(),
      category: z.string(), // an option code, or "SKIP"
      pattern: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
});

export async function suggestCategorizations(
  householdId: string,
): Promise<{ suggestions: AiSuggestion[]; remainingMerchants: number }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set - add it to the app's environment to enable AI suggestions.",
    );
  }

  const [allMerchants, options] = await Promise.all([
    getUncategorizedMerchants(householdId),
    getCategoryOptions(householdId),
  ]);
  const batch = allMerchants.slice(0, MAX_MERCHANTS_PER_BATCH);
  if (batch.length === 0 || options.length === 0) {
    return { suggestions: [], remainingMerchants: 0 };
  }

  const client = new Anthropic();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system:
      "You categorize bank transactions for a household budget. For each merchant, " +
      "pick the best-fitting category code from the provided list, or SKIP when no " +
      "category fits or you cannot tell (transfers between own accounts, credit card " +
      "payments, and ambiguous entries should be SKIP). Also propose a short " +
      "case-insensitive substring of the merchant text usable as a durable matching " +
      "rule (brand name only - no store numbers, dates, or amounts). Positive totals " +
      "are money in (income categories); negative totals are spending.",
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          categories: options.map((o) => ({ code: o.code, label: o.label, kind: o.kind })),
          merchants: batch.map((m) => ({
            merchant: m.key,
            sample: m.sampleDescription,
            transactions: m.count,
            netDollars: Math.round(m.totalCents / 100),
          })),
        }),
      },
    ],
    output_config: { format: zodOutputFormat(ResponseSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("The model returned an unparseable response.");

  const optionByCode = new Map(options.map((o) => [o.code, o]));
  const merchantByKey = new Map(batch.map((m) => [m.key, m]));
  const suggestions: AiSuggestion[] = [];

  for (const item of parsed.suggestions) {
    const merchant = merchantByKey.get(item.merchant);
    if (!merchant) continue; // hallucinated merchant - drop
    const option =
      item.category === "SKIP" ? null : (optionByCode.get(item.category) ?? null);

    // The pattern must actually match the sample it came from, or a rule
    // built from it would never fire - fall back to the merchant key.
    const pattern = ruleMatches(merchant.sampleDescription, {
      pattern: item.pattern,
      matchType: "contains",
    })
      ? item.pattern.trim()
      : merchant.key;

    suggestions.push({ merchant, option, pattern, confidence: item.confidence });
  }

  return {
    suggestions,
    remainingMerchants: Math.max(0, allMerchants.length - batch.length),
  };
}
