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
import { removeMember, saveMember } from "@/server/actions/members";
import type { MemberListRow } from "@/server/db/queries/members";

const ROLES = [
  { value: "owner", label: "Owner — manages members and settings" },
  { value: "member", label: "Member" },
] as const;

const PERSON_TYPES = [
  { value: "adult", label: "Adult" },
  { value: "child", label: "Child" },
] as const;

const NONE = "";
const NEW = "__new__";

export function MemberDialog({
  member,
  persons,
  isSelf,
  trigger,
  triggerClassName,
}: {
  member: MemberListRow;
  // Active persons in the household not linked to a different login, plus
  // this member's own person (so it stays selectable).
  persons: { id: string; name: string }[];
  isSelf: boolean;
  trigger: React.ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [personChoice, setPersonChoice] = useState<string>(member.personId ?? NONE);
  const [error, formAction, pending] = useActionState(
    async (_prev: string | undefined, formData: FormData) => {
      try {
        await saveMember(formData);
        setOpen(false);
        return undefined;
      } catch (e) {
        return e instanceof Error ? e.message : "Couldn't save that member.";
      }
    },
    undefined,
  );
  const [removeError, removeAction, removing] = useActionState(async () => {
    if (!confirm(`Remove ${member.name ?? member.email}'s access to this household?`)) {
      return undefined;
    }
    try {
      await removeMember(member.userId);
      setOpen(false);
      return undefined;
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't remove that member.";
    }
  }, undefined);

  const personItems: Record<string, string> = {
    [NONE]: "No person (login only)",
    ...Object.fromEntries(persons.map((p) => [p.id, p.name])),
    [NEW]: "Create a new person…",
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={triggerClassName}>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{member.name ?? member.email}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="userId" value={member.userId} />
          <p className="text-sm text-muted-foreground">
            {member.haUserId
              ? "Signs in through Home Assistant."
              : "Signs in with an email and password."}
            {member.role === null && " Not yet a member — saving admits them."}
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`person-${member.userId}`}>Person</Label>
            <Select
              name="personId"
              value={personChoice}
              onValueChange={(v) => setPersonChoice((v as string | null) ?? NONE)}
              items={personItems}
            >
              <SelectTrigger id={`person-${member.userId}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(personItems).map(([value, label]) => (
                  <SelectItem key={value || "none"} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The person decides which accounts this login can see once sharing rules are set
              up.
            </p>
          </div>
          {personChoice === NEW && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`new-name-${member.userId}`}>New person&apos;s name</Label>
                <Input
                  id={`new-name-${member.userId}`}
                  name="newPersonName"
                  required
                  defaultValue={member.name ?? ""}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`new-type-${member.userId}`}>Type</Label>
                <Select
                  name="newPersonType"
                  defaultValue="adult"
                  items={Object.fromEntries(PERSON_TYPES.map((t) => [t.value, t.label]))}
                >
                  <SelectTrigger id={`new-type-${member.userId}`} className="w-full">
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
            </>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor={`role-${member.userId}`}>Role</Label>
            <Select
              name="role"
              defaultValue={member.role ?? "member"}
              items={Object.fromEntries(ROLES.map((r) => [r.value, r.label]))}
            >
              <SelectTrigger id={`role-${member.userId}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(error || removeError) && (
            <p className="text-sm text-destructive">{error ?? removeError}</p>
          )}
          <DialogFooter className="gap-2">
            {member.role !== null && !isSelf && (
              <Button
                type="button"
                variant="destructive"
                disabled={removing}
                onClick={() => removeAction()}
              >
                {removing ? "Removing…" : "Remove access"}
              </Button>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : member.role === null ? "Add to household" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
