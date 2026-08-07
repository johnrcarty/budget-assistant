"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createRule, updateRule } from "@/server/actions/categorization";

const MATCH_TYPES = {
  contains: "Contains",
  starts_with: "Starts with",
  exact: "Exactly matches",
} as const;

const ANY_ACCOUNT = "any";
// Action-only rule: no category, just the sign fix below.
const NO_TARGET = "none";
const NO_TARGET_LABEL = "No category — sign fix only";

export interface RuleInitialValues {
  ruleId: string;
  pattern: string;
  matchType: keyof typeof MATCH_TYPES;
  target: string | null; // "expense:<id>" / "income:<id>", null if target deleted
  accountId: string | null;
  amount: string | null; // dollars, e.g. "12.34"
  forceInflow: boolean;
  priority: number;
}

export function RuleDialog({
  targets,
  accounts,
  trigger,
  triggerClassName,
  initial,
}: {
  targets: { value: string; label: string }[];
  accounts: { value: string; label: string }[];
  trigger: React.ReactNode;
  triggerClassName?: string;
  initial?: RuleInitialValues;
}) {
  const [open, setOpen] = useState(false);
  const [error, formAction, pending] = useActionState(
    async (_prev: string | undefined, formData: FormData) => {
      try {
        if (initial) {
          await updateRule(initial.ruleId, formData);
        } else {
          await createRule(formData);
        }
        setOpen(false);
        return undefined;
      } catch {
        return "Couldn't save that rule.";
      }
    },
    undefined,
  );

  const targetOptions = [
    ...targets,
    { value: NO_TARGET, label: NO_TARGET_LABEL },
  ];
  const targetItems = Object.fromEntries(
    targetOptions.map((t) => [t.value, t.label]),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={triggerClassName}>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Rule" : "New Rule"}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex w-36 flex-col gap-2">
              <Label htmlFor="rule-match-type">Match</Label>
              <Select
                name="matchType"
                defaultValue={initial?.matchType ?? "contains"}
                items={MATCH_TYPES}
              >
                <SelectTrigger id="rule-match-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MATCH_TYPES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="rule-pattern">Description text</Label>
              <Input
                id="rule-pattern"
                name="pattern"
                placeholder="e.g. NETFLIX"
                defaultValue={initial?.pattern}
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="rule-target">Categorize as</Label>
            <Select
              name="target"
              defaultValue={initial?.target ?? undefined}
              items={targetItems}
            >
              <SelectTrigger id="rule-target" className="w-full">
                <SelectValue placeholder="Pick a category" />
              </SelectTrigger>
              <SelectContent>
                {targetOptions.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                name="forceInflow"
                value="on"
                defaultChecked={initial?.forceInflow ?? false}
                className="mt-0.5"
              />
              <span>Treat matches as money in (force positive)</span>
            </label>
            <p className="text-xs text-muted-foreground">
              For banks that report deposits with the wrong sign — Fidelity
              sends payroll direct deposits and 401k contributions as negative.
              Applied on every bank sync. Scope it with an account and a
              specific description so real purchases can&apos;t match.
            </p>
          </div>

          <details
            open={Boolean(
              initial &&
                (initial.accountId || initial.amount || initial.priority !== 100),
            )}
          >
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Extra conditions (optional)
            </summary>
            <div className="mt-3 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="rule-account">Only this account</Label>
                <Select
                  name="accountId"
                  defaultValue={initial?.accountId ?? ANY_ACCOUNT}
                  items={{
                    [ANY_ACCOUNT]: "Any account",
                    ...Object.fromEntries(accounts.map((a) => [a.value, a.label])),
                  }}
                >
                  <SelectTrigger id="rule-account" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_ACCOUNT}>Any account</SelectItem>
                    {accounts.map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-3">
                <div className="flex flex-1 flex-col gap-2">
                  <Label htmlFor="rule-amount">Exact amount</Label>
                  <Input
                    id="rule-amount"
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="any"
                    defaultValue={initial?.amount ?? undefined}
                  />
                </div>
                <div className="flex w-28 flex-col gap-2">
                  <Label htmlFor="rule-priority">Priority</Label>
                  <Input
                    id="rule-priority"
                    name="priority"
                    type="number"
                    min="0"
                    max="9999"
                    defaultValue={initial?.priority ?? 100}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Amount matches regardless of sign. Lower priority runs first
                (1 before 2) — put specific rules below 100 so they beat
                general ones.
              </p>
            </div>
          </details>

          <p className="text-xs text-muted-foreground">
            Matching is case-insensitive. Rules run automatically on every bank sync
            and CSV import, and against existing uncategorized transactions.
          </p>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : initial ? "Save Changes" : "Add Rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
