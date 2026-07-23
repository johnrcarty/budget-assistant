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
import { archivePerson, unarchivePerson, updatePerson } from "@/server/actions/people";
import { PersonColorField } from "./PersonColorField";

const PERSON_TYPES = [
  { value: "adult", label: "Adult" },
  { value: "child", label: "Child" },
] as const;

export function EditPersonDialog({
  person,
  trigger,
  triggerClassName,
}: {
  person: {
    id: string;
    name: string;
    personType: string;
    color: string | null;
    isActive: boolean;
  };
  trigger: React.ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await updatePerson(person.id, formData);
        setOpen(false);
        return undefined;
      } catch {
        return "Couldn't save those changes — the name may already be in use.";
      }
    },
    undefined,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={triggerClassName}>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Person</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-person-name">Name</Label>
            <Input id="edit-person-name" name="name" defaultValue={person.name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-person-type">Type</Label>
            <Select name="personType" defaultValue={person.personType}>
              <SelectTrigger id="edit-person-type" className="w-full">
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
          <PersonColorField defaultColor={person.color} idPrefix="edit-person" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>

        {person.isActive ? (
          <form action={archivePerson.bind(null, person.id)} className="border-t pt-3">
            <button type="submit" className="text-sm text-muted-foreground hover:text-destructive">
              Archive person
            </button>
          </form>
        ) : (
          <form action={unarchivePerson.bind(null, person.id)} className="border-t pt-3">
            <button type="submit" className="text-sm text-muted-foreground hover:text-primary">
              Unarchive person
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
