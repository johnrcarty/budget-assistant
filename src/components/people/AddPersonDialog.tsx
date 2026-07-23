"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
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
import { createPerson } from "@/server/actions/people";
import { PersonColorField } from "./PersonColorField";

const PERSON_TYPES = [
  { value: "adult", label: "Adult" },
  { value: "child", label: "Child" },
] as const;

export function AddPersonDialog() {
  const [open, setOpen] = useState(false);
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await createPerson(formData);
        setOpen(false);
        return undefined;
      } catch {
        return "Couldn't add that person — the name may already be in use.";
      }
    },
    undefined,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger aria-label="Add person" className="text-foreground">
        <Plus className="size-6" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Person</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="person-name">Name</Label>
            <Input id="person-name" name="name" required autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="person-type">Type</Label>
            <Select name="personType" defaultValue="adult">
              <SelectTrigger id="person-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERSON_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <PersonColorField idPrefix="add-person" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add Person"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
