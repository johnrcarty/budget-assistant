"use client";

import { useActionState, useState } from "react";
import { CirclePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createIncomeItem } from "@/server/actions/income-items";

export function AddIncomeItemDialog({ month }: { month: string }) {
  const [open, setOpen] = useState(false);
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await createIncomeItem(formData);
        setOpen(false);
        return undefined;
      } catch {
        return "Couldn't add that income. Check the name and amount.";
      }
    },
    undefined,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="flex items-center gap-2 text-sm font-medium text-primary">
        <CirclePlus className="size-4" />
        Add Income
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Income</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="month" value={month} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="income-name">Name</Label>
            <Input id="income-name" name="name" required autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="income-amount">Planned amount</Label>
            <Input
              id="income-amount"
              name="plannedAmount"
              type="number"
              step="0.01"
              min="0"
              defaultValue="0"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add Income"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
