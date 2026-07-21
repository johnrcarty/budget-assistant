"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateDebtPlanSettings } from "@/server/actions/debt-plan";

const STRATEGIES = [
  {
    key: "snowball",
    label: "Snowball",
    hint: "Smallest balance first — quick wins",
  },
  {
    key: "avalanche",
    label: "Avalanche",
    hint: "Highest rate first — least interest",
  },
] as const;

export function DebtPlanControls({
  strategy,
  extraMonthlyCents,
}: {
  strategy: "snowball" | "avalanche";
  extraMonthlyCents: number;
}) {
  const [selected, setSelected] = useState<"snowball" | "avalanche">(strategy);
  const [error, formAction, pending] = useActionState(
    async (_prev: string | undefined, formData: FormData) => {
      try {
        await updateDebtPlanSettings(formData);
        return undefined;
      } catch {
        return "Couldn't save the plan settings.";
      }
    },
    undefined,
  );

  const hint = STRATEGIES.find((s) => s.key === selected)?.hint;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="strategy" value={selected} />
      <div className="flex rounded-lg bg-muted p-1 text-sm font-medium">
        {STRATEGIES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSelected(key)}
            className={`flex-1 rounded-md py-1.5 text-center ${
              selected === key
                ? "bg-secondary text-secondary-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>

      <div className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="extraMonthly">Extra toward debt each month</Label>
          <Input
            id="extraMonthly"
            name="extraMonthly"
            type="number"
            step="0.01"
            min="0"
            defaultValue={extraMonthlyCents > 0 ? (extraMonthlyCents / 100).toFixed(2) : ""}
            placeholder="0.00"
          />
        </div>
        <Button type="submit" disabled={pending} size="sm">
          {pending ? "Saving…" : "Update plan"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
