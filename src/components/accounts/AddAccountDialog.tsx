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
import { createAccount } from "@/server/actions/accounts";
import { ACCOUNT_KINDS } from "./account-kinds";

const PHYSICAL_ASSET_KINDS = new Set(["property", "vehicle"]);

export function AddAccountDialog() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("checking");
  const isPhysicalAsset = PHYSICAL_ASSET_KINDS.has(kind);
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await createAccount(formData);
        setOpen(false);
        return undefined;
      } catch {
        return "Couldn't create that account.";
      }
    },
    undefined,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger aria-label="Add account" className="text-foreground">
        <Plus className="size-6" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Account</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="account-name">Name</Label>
            <Input id="account-name" name="name" required autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="account-kind">Type</Label>
            <Select name="kind" value={kind} onValueChange={(v) => v && setKind(v)}>
              <SelectTrigger id="account-kind" className="w-full">
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
          <div className="flex flex-col gap-2">
            <Label htmlFor="account-balance">
              {isPhysicalAsset ? "Current value" : "Starting balance"}
            </Label>
            <Input
              id="account-balance"
              name="startingBalance"
              type="number"
              step="0.01"
              defaultValue="0"
            />
          </div>
          {isPhysicalAsset && (
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="account-purchase-price">Purchase price</Label>
                <Input
                  id="account-purchase-price"
                  name="purchasePrice"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Optional"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="account-purchase-date">Purchased on</Label>
                <Input id="account-purchase-date" name="purchaseDate" type="date" />
              </div>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add Account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
