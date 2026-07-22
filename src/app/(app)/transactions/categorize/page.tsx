import { Plus } from "lucide-react";
import { getCurrentHousehold } from "@/server/lib/dal";
import { getUncategorizedCount } from "@/server/db/queries/transactions";
import { getAccounts } from "@/server/db/queries/accounts";
import { formatCents } from "@/server/lib/money";
import {
  getExpenseTargets,
  getIncomeTargets,
  getRules,
} from "@/server/db/queries/categorization";
import { getUncategorizedMerchants } from "@/server/lib/ai-categorize";
import { deleteRule } from "@/server/actions/categorization";
import { AppHeader } from "@/components/layout/AppHeader";
import { AiSuggestPanel } from "@/components/categorize/AiSuggestPanel";
import { RuleDialog } from "@/components/categorize/RuleDialog";
import { RunRulesButton } from "@/components/categorize/RunRulesButton";

const MATCH_LABELS: Record<string, string> = {
  contains: "contains",
  starts_with: "starts with",
  exact: "is exactly",
};

export default async function CategorizePage() {
  const householdId = await getCurrentHousehold();
  const [uncategorizedCount, merchants, rules, expenseTargets, incomeTargets, accountList] =
    await Promise.all([
      getUncategorizedCount(householdId),
      getUncategorizedMerchants(householdId),
      getRules(householdId),
      getExpenseTargets(householdId),
      getIncomeTargets(householdId),
      getAccounts(householdId),
    ]);

  const targets = [
    { value: "transfer", label: "Transfer between accounts (not income/spending)" },
    ...expenseTargets.map((t) => ({
      value: `expense:${t.id}`,
      label: `${t.groupName} › ${t.name}`,
    })),
    ...incomeTargets.map((t) => ({
      value: `income:${t.id}`,
      label:
        t.slotCount > 1
          ? `Income › ${t.name} (${t.slotCount} checks, filled in order)`
          : `Income › ${t.name}`,
    })),
  ];
  const accountOptions = accountList.map((a) => ({ value: a.id, label: a.name }));

  return (
    <div>
      <AppHeader title="Categorize" backHref="/transactions" />
      <div className="flex flex-col gap-4 px-4 pb-4">
        <div className="rounded-xl bg-card p-4 shadow-xs">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{uncategorizedCount}</span>{" "}
            uncategorized {uncategorizedCount === 1 ? "transaction" : "transactions"}{" "}
            across{" "}
            <span className="font-semibold text-foreground">{merchants.length}</span>{" "}
            {merchants.length === 1 ? "merchant" : "merchants"} not covered by a rule.
          </p>
        </div>

        <div className="rounded-xl bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between pb-2">
            <h2 className="font-semibold">AI suggestions</h2>
          </div>
          <AiSuggestPanel hasApiKey={Boolean(process.env.ANTHROPIC_API_KEY)} />
        </div>

        <div className="rounded-xl bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between pb-1">
            <h2 className="font-semibold">Rules</h2>
            <RuleDialog
              targets={targets}
              accounts={accountOptions}
              triggerClassName="text-foreground"
              trigger={<Plus className="size-5" aria-label="Add rule" />}
            />
          </div>
          {rules.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              No rules yet. Add one manually or accept AI suggestions above -
              rules also run automatically on every bank sync and CSV import.
            </p>
          ) : (
            <div className="pb-3">
              {rules.map(({ rule, targetLabel, accountName }) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1 text-sm">
                    <span className="text-muted-foreground">
                      {MATCH_LABELS[rule.matchType]}
                    </span>{" "}
                    <span className="font-medium">&ldquo;{rule.pattern}&rdquo;</span>{" "}
                    <span className="text-muted-foreground">→ {targetLabel}</span>
                    <div className="text-xs text-muted-foreground">
                      priority {rule.priority}
                      {accountName ? ` · ${accountName} only` : ""}
                      {rule.amountCents != null
                        ? ` · exactly ${formatCents(rule.amountCents)}`
                        : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <RuleDialog
                      targets={targets}
                      accounts={accountOptions}
                      triggerClassName="text-xs text-muted-foreground hover:text-foreground"
                      trigger="Edit"
                      initial={{
                        ruleId: rule.id,
                        pattern: rule.pattern,
                        matchType: rule.matchType,
                        target: rule.markAsTransfer
                          ? "transfer"
                          : rule.lineItemTemplateId
                            ? `expense:${rule.lineItemTemplateId}`
                            : rule.incomeTemplateId
                              ? `income:${rule.incomeTemplateId}`
                              : null,
                        accountId: rule.accountId,
                        amount:
                          rule.amountCents != null
                            ? (rule.amountCents / 100).toFixed(2)
                            : null,
                        priority: rule.priority,
                      }}
                    />
                    <form action={deleteRule.bind(null, rule.id)}>
                      <button
                        type="submit"
                        className="text-xs text-muted-foreground hover:text-destructive"
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
          <RunRulesButton />
        </div>
      </div>
    </div>
  );
}
