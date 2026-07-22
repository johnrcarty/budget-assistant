// Pure matching logic for categorization rules - importable from client,
// server, and verification scripts.

export type RuleMatchType = "contains" | "starts_with" | "exact";

export interface MatchableRule {
  pattern: string;
  matchType: RuleMatchType;
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

// First matching rule wins; callers pass rules already ordered by priority.
export function findMatchingRule<T extends MatchableRule>(
  description: string,
  rules: T[],
): T | null {
  for (const rule of rules) {
    if (ruleMatches(description, rule)) return rule;
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
