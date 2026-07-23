"use client";

import { useActionState, useState } from "react";
import { CirclePlus } from "lucide-react";
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
import { createIncomeItem } from "@/server/actions/income-items";

const NO_PERSON = "";

export function AddIncomeItemDialog({
  month,
  persons = [],
}: {
  month: string;
  persons?: { id: string; name: string }[];
}) {
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
          {persons.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="income-person">Person</Label>
              <Select
                name="personId"
                defaultValue={NO_PERSON}
                items={{
                  [NO_PERSON]: "Other income (no person)",
                  ...Object.fromEntries(persons.map((p) => [p.id, p.name])),
                }}
              >
                <SelectTrigger id="income-person" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PERSON}>Other income (no person)</SelectItem>
                  {persons.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Picking a person makes this their next paycheck slot instead of a
                one-off item.
              </p>
            </div>
          )}
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
