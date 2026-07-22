"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { createRule } from "@/server/actions/categorization";

const MATCH_TYPES = {
  contains: "Contains",
  starts_with: "Starts with",
  exact: "Exactly matches",
} as const;

const ANY_ACCOUNT = "any";

export function RuleDialog({
  targets,
  accounts,
  trigger,
  triggerClassName,
}: {
  targets: { value: string; label: string }[];
  accounts: { value: string; label: string }[];
  trigger: React.ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, formAction, pending] = useActionState(
    async (_prev: string | undefined, formData: FormData) => {
      try {
        await createRule(formData);
        setOpen(false);
        return undefined;
      } catch {
        return "Couldn't save that rule.";
      }
    },
    undefined,
  );

  const targetItems = Object.fromEntries(targets.map((t) => [t.value, t.label]));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={triggerClassName}>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Rule</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex w-36 flex-col gap-2">
              <Label htmlFor="rule-match-type">Match</Label>
              <Select name="matchType" defaultValue="contains" items={MATCH_TYPES}>
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
              <Input id="rule-pattern" name="pattern" placeholder="e.g. NETFLIX" required />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="rule-target">Categorize as</Label>
            <Select name="target" items={targetItems}>
              <SelectTrigger id="rule-target" className="w-full">
                <SelectValue placeholder="Pick a category" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Extra conditions (optional)
            </summary>
            <div className="mt-3 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="rule-account">Only this account</Label>
                <Select
                  name="accountId"
                  defaultValue={ANY_ACCOUNT}
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
                  />
                </div>
                <div className="flex w-28 flex-col gap-2">
                  <Label htmlFor="rule-priority">Priority</Label>
                  <Input
                    id="rule-priority"
                    name="priority"
                    type="number"
                    min="1"
                    max="9999"
                    defaultValue={100}
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
              {pending ? "Saving…" : "Add Rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
