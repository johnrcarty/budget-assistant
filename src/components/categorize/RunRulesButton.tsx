"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { runRules } from "@/server/actions/categorization";

export function RunRulesButton() {
  const [result, formAction, pending] = useActionState(
    async () => {
      try {
        const { matched, scanned } = await runRules();
        return matched > 0
          ? `Categorized ${matched} of ${scanned} uncategorized transactions.`
          : `No matches among ${scanned} uncategorized transactions.`;
      } catch {
        return "Running rules failed.";
      }
    },
    undefined,
  );

  return (
    <form action={formAction} className="flex items-center gap-3">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Running…" : "Run rules now"}
      </Button>
      {result && <span className="text-sm text-muted-foreground">{result}</span>}
    </form>
  );
}
