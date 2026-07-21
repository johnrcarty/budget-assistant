"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { updateDebtAccountInfo } from "@/server/actions/debt";
import type { accounts } from "@/server/db/schema";

export function DebtInfoForm({ account }: { account: typeof accounts.$inferSelect }) {
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await updateDebtAccountInfo(account.id, formData);
        return undefined;
      } catch {
        return "Couldn't save those changes.";
      }
    },
    undefined,
  );

  return (
    <Card>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="debt-name">Debt Name</Label>
            <Input id="debt-name" name="name" defaultValue={account.name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="debt-type">Debt Type</Label>
            <Input
              id="debt-type"
              name="subtype"
              defaultValue={account.subtype ?? ""}
              placeholder="e.g. Credit Card, Student Loan, Medical"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="original-balance">Original Balance (optional)</Label>
            <Input
              id="original-balance"
              name="originalBalance"
              type="number"
              step="0.01"
              min="0"
              defaultValue={
                account.originalBalanceCents ? (account.originalBalanceCents / 100).toFixed(2) : ""
              }
              placeholder="Balance when this debt started"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending} size="sm" className="self-start">
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
