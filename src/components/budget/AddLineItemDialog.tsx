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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryIcon } from "./category-icons";
import { createLineItem } from "@/server/actions/budget-line-items";

export interface AddItemGroupOption {
  id: string;
  name: string;
  icon: string | null;
}

// Two homes: inside a category card (categoryGroupId fixed, hidden input)
// and in the month header (groups list, user picks the category).
export function AddLineItemDialog({
  month,
  categoryGroupId,
  groups,
  triggerContent,
  triggerClassName,
}: {
  month: string;
  categoryGroupId?: string;
  groups?: AddItemGroupOption[];
  triggerContent?: React.ReactNode;
  triggerClassName?: string;
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
      <DialogTrigger
        className={
          triggerClassName ??
          "flex items-center gap-2 text-sm font-medium text-primary"
        }
      >
        {triggerContent ?? (
          <>
            <CirclePlus className="size-4" />
            Add Item
          </>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Item</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {categoryGroupId ? (
            <input type="hidden" name="categoryGroupId" value={categoryGroupId} />
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="item-group">Category</Label>
              <Select
                name="categoryGroupId"
                defaultValue={groups?.[0]?.id}
                items={Object.fromEntries(
                  (groups ?? []).map((group) => [
                    group.id,
                    <span key={group.id} className="flex items-center gap-1.5">
                      <CategoryIcon
                        name={group.name}
                        storedIcon={group.icon}
                        className="size-4 text-muted-foreground"
                      />
                      {group.name}
                    </span>,
                  ]),
                )}
              >
                <SelectTrigger id="item-group" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(groups ?? []).map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      <CategoryIcon
                        name={group.name}
                        storedIcon={group.icon}
                        className="size-4 text-muted-foreground"
                      />
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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
