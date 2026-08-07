// Pure matching logic for categorization rules - importable from client,
// server, and verification scripts.

export type RuleMatchType = "contains" | "starts_with" | "exact";

export interface MatchableRule {
  pattern: string;
  matchType: RuleMatchType;
  // Optional extra conditions, ANDed with the pattern.
  accountId?: string | null;
  amountCents?: number | null; // compared by absolute value
  // Sign-correction action, orthogonal to the categorization targets.
  forceInflow?: boolean | null;
}

export interface MatchableTransaction {
  description: string;
  accountId?: string;
  amountCents?: number;
}

export function ruleMatches(description: string, rule: MatchableRule): boolean {
  const haystack = description.trim().toLowerCase();
  const needle = rule.pattern.trim().toLowerCase();
  if (!needle) return false;

  switch (rule.matchType) {
    case "contains":
      return haystack.includes(needle);
    case "starts_with":
      return haystack.startsWith(needle);
    case "exact":
      return haystack === needle;
  }
}

export function transactionMatchesRule(
  tx: MatchableTransaction,
  rule: MatchableRule,
): boolean {
  if (!ruleMatches(tx.description, rule)) return false;
  if (rule.accountId != null && rule.accountId !== tx.accountId) return false;
  if (
    rule.amountCents != null &&
    Math.abs(rule.amountCents) !== Math.abs(tx.amountCents ?? Number.NaN)
  ) {
    return false;
  }
  return true;
}

// First matching rule wins; callers pass rules already ordered by priority
// (lower runs first).
export function findMatchingRule<T extends MatchableRule>(
  tx: MatchableTransaction,
  rules: T[],
): T | null {
  for (const rule of rules) {
    if (transactionMatchesRule(tx, rule)) return rule;
  }
  return null;
}

// A rule with no target does nothing during categorization - it exists only
// for its action columns (today: forceInflow). Letting one reach
// findMatchingRule would let it match first and silently shadow a
// lower-priority rule that does have a target.
export function hasCategorizationTarget(rule: {
  lineItemTemplateId?: string | null;
  incomeTemplateId?: string | null;
  markAsTransfer?: boolean | null;
}): boolean {
  return Boolean(
    rule.lineItemTemplateId || rule.incomeTemplateId || rule.markAsTransfer,
  );
}

// Sign correction is resolved INDEPENDENTLY of findMatchingRule: a
// higher-priority categorization rule matching the same description must not
// shadow the sign fix, and vice versa. Only forceInflow rules are considered,
// first match by the caller's ordering wins.
export function resolveInflow<T extends MatchableRule>(
  rawCents: number,
  tx: MatchableTransaction,
  rules: T[],
): number {
  for (const rule of rules) {
    if (!rule.forceInflow) continue;
    // Match against the raw amount - transactionMatchesRule compares
    // amountCents by absolute value, so the inverted sign can't defeat it.
    if (transactionMatchesRule({ ...tx, amountCents: rawCents }, rule)) {
      return Math.abs(rawCents);
    }
  }
  return rawCents;
}

// Collapses a raw bank description to a stable merchant key so repeated
// charges group together: uppercase, strip long digit runs (card numbers,
// dates, confirmation codes), collapse whitespace.
export function merchantKey(description: string): string {
  return description
    .toUpperCase()
    .replace(/[#*]/g, " ")
    .replace(/\b[\d\-/.]{3,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
