"use client";

import { useActionState, useState } from "react";
import { Pencil } from "lucide-react";
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
import { updateAccount } from "@/server/actions/accounts";
import { ACCOUNT_KINDS } from "./account-kinds";

export function EditAccountDialog({
  account,
}: {
  account: { id: string; name: string; kind: string };
}) {
  const [open, setOpen] = useState(false);
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await updateAccount(account.id, formData);
        setOpen(false);
        return undefined;
      } catch {
        return "Couldn't save those changes.";
      }
    },
    undefined,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label={`Edit ${account.name}`}
        className="text-muted-foreground hover:text-foreground"
      >
        <Pencil className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Account</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-account-name">Name</Label>
            <Input id="edit-account-name" name="name" defaultValue={account.name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-account-kind">Type</Label>
            <Select name="kind" defaultValue={account.kind}>
              <SelectTrigger id="edit-account-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Credit cards, loans, and lines of credit are tracked as debts; everything
            else counts as an asset.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
