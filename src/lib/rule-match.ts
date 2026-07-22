// Pure matching logic for categorization rules - importable from client,
// server, and verification scripts.

export type RuleMatchType = "contains" | "starts_with" | "exact";

export interface MatchableRule {
  pattern: string;
  matchType: RuleMatchType;
  // Optional extra conditions, ANDed with the pattern.
  accountId?: string | null;
  amountCents?: number | null; // compared by absolute value
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
