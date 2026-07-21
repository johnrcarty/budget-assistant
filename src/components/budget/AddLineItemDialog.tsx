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
import { createLineItem } from "@/server/actions/budget-line-items";

export function AddLineItemDialog({
  categoryGroupId,
  month,
}: {
  categoryGroupId: string;
  month: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await createLineItem(formData);
        setOpen(false);
        return undefined;
      } catch {
        return "Couldn't add that item. Check the name and amount.";
      }
    },
    undefined,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="flex items-center gap-2 text-sm font-medium text-primary">
        <CirclePlus className="size-4" />
        Add Item
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Item</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="categoryGroupId" value={categoryGroupId} />
          <input type="hidden" name="month" value={month} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="item-name">Name</Label>
            <Input id="item-name" name="name" required autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="item-amount">Planned amount</Label>
            <Input
              id="item-amount"
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
              {pending ? "Adding…" : "Add Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
