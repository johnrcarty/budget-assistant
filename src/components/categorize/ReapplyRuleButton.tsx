"use client";

import { useActionState } from "react";
import { reapplyRule } from "@/server/actions/categorization";

// Per-rule force re-run: unlike "Run rules now" (uncategorized only), this
// re-categorizes everything the rule matches, including transactions already
// assigned elsewhere - for after a rule's target has been edited.
export function ReapplyRuleButton({ ruleId }: { ruleId: string }) {
  const [result, formAction, pending] = useActionState(
    async () => {
      try {
        const { matched, scanned } = await reapplyRule(ruleId);
        return matched > 0
          ? `Recategorized ${matched} of ${scanned} matching.`
          : `No changes among ${scanned} matching.`;
      } catch {
        return "Re-apply failed.";
      }
    },
    undefined,
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        {pending ? "Re-applying…" : "Re-apply"}
      </button>
      {result && (
        <span className="text-xs whitespace-nowrap text-muted-foreground">{result}</span>
      )}
    </form>
  );
}
