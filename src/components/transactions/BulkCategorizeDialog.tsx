"use client";

import { useActionState, useState } from "react";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { bulkCategorizeTransactions } from "@/server/actions/transactions";
import type { TransactionWhereFilters } from "@/server/db/queries/transactions";
import type { ExpenseTarget, IncomeTarget } from "./TransactionDialog";

export function BulkCategorizeDialog({
  filters,
  totalCount,
  expenseTargets,
  incomeTargets,
}: {
  filters: TransactionWhereFilters;
  totalCount: number;
  expenseTargets: ExpenseTarget[];
  incomeTargets: IncomeTarget[];
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("none");

  const [error, formAction, pending] = useActionState(
    async (): Promise<string | undefined> => {
      try {
        await bulkCategorizeTransactions(filters, category);
        setOpen(false);
        return undefined;
      } catch {
        return "Couldn't apply the category. Try again.";
      }
    },
    undefined,
  );

  const options: { value: string; label: string }[] = [
    { value: "none", label: "Uncategorized" },
    { value: "transfer", label: "Transfer between accounts" },
    ...expenseTargets.map((t) => ({ value: `expense:${t.id}`, label: `${t.groupName} › ${t.name}` })),
    ...incomeTargets.map((t) => ({ value: `income:${t.id}`, label: `Income: ${t.name}` })),
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <Wand2 className="size-4" />
        Bulk categorize
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk Categorize</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Applies this category to all{" "}
            <span className="font-medium text-foreground">{totalCount}</span>{" "}
            {totalCount === 1 ? "transaction" : "transactions"} matching the current
            filters, including those on other pages - each lands on its own
            month, even if the filter spans several. Existing categories are
            overwritten.
          </p>

          <div className="flex flex-col gap-2">
            <Label htmlFor="bulk-category">Category</Label>
            <Select
              value={category}
              onValueChange={(v) => v && setCategory(v)}
              items={Object.fromEntries(options.map((o) => [o.value, o.label]))}
            >
              <SelectTrigger id="bulk-category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || totalCount === 0}>
              {pending
                ? "Applying…"
                : `Apply to ${totalCount} ${totalCount === 1 ? "transaction" : "transactions"}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
