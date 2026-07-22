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

export function RuleDialog({
  targets,
  trigger,
  triggerClassName,
}: {
  targets: { value: string; label: string }[];
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
