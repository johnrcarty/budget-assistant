"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
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
import { archiveAccount, updateAccount } from "@/server/actions/accounts";
import { ACCOUNT_KINDS } from "./account-kinds";
import { AssetValueForm } from "./AssetValueForm";

export function EditAccountDialog({
  account,
  trigger,
  triggerClassName,
}: {
  account: {
    id: string;
    name: string;
    kind: string;
    isLiability: boolean;
    isManual?: boolean;
    currentBalanceCents?: number | null;
    originalBalanceCents?: number | null;
  };
  trigger: React.ReactNode;
  triggerClassName?: string;
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
      <DialogTrigger className={triggerClassName}>{trigger}</DialogTrigger>
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
            else — including property and vehicles — counts as an asset.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>

        {/* UI-gated to property/vehicle (tighter than the server guard):
            transaction-driven manual accounts derive their trend from
            transactions, and a manual value write would fight that anchor. */}
        {!account.isLiability &&
          account.isManual &&
          (account.kind === "property" || account.kind === "vehicle") && (
            <div className="border-t pt-3">
              <h3 className="pb-2 text-sm font-medium">Update value</h3>
              <AssetValueForm
                accountId={account.id}
                currentBalanceCents={account.currentBalanceCents ?? null}
                originalBalanceCents={account.originalBalanceCents ?? null}
              />
            </div>
          )}

        {account.isLiability && (
          <Link
            href={`/accounts/${account.id}`}
            className="flex items-center justify-between border-t pt-3 text-sm font-medium"
          >
            Debt details, balance &amp; terms
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        )}

        <form action={archiveAccount.bind(null, account.id)} className="border-t pt-3">
          <button
            type="submit"
            className="text-sm text-muted-foreground hover:text-destructive"
          >
            Archive account
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
