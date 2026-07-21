"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addBalanceSnapshot } from "@/server/actions/debt";
import type { debtBalanceSnapshots } from "@/server/db/schema";

export function DebtBalanceForm({
  accountId,
  latestBalance,
}: {
  accountId: string;
  latestBalance: typeof debtBalanceSnapshots.$inferSelect | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await addBalanceSnapshot(accountId, formData);
        return undefined;
      } catch {
        return "Couldn't save that balance.";
      }
    },
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="balance">Current Balance</Label>
          <Input
            id="balance"
            name="balance"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={
              latestBalance ? (latestBalance.balanceCents / 100).toFixed(2) : undefined
            }
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="asOfDate">As of</Label>
          <Input id="asOfDate" name="asOfDate" type="date" defaultValue={today} required />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} size="sm" className="self-start">
        {pending ? "Saving…" : "Update Balance"}
      </Button>
    </form>
  );
}
