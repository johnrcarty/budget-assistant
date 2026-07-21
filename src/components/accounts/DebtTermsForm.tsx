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
import { addDebtTermsVersion } from "@/server/actions/debt";
import type { debtTermsVersions } from "@/server/db/schema";

export function DebtTermsForm({
  accountId,
  currentTerms,
}: {
  accountId: string;
  currentTerms: typeof debtTermsVersions.$inferSelect | null;
}) {
  const [termsType, setTermsType] = useState<"revolving" | "installment">(
    currentTerms?.termsType ?? "revolving",
  );
  const today = new Date().toISOString().slice(0, 10);
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await addDebtTermsVersion(accountId, formData);
        return undefined;
      } catch {
        return "Couldn't save those terms.";
      }
    },
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Saving here records a new terms change effective today - past terms stay
        on the record for whatever period they applied to.
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="termsType">Type</Label>
        <Select
          name="termsType"
          value={termsType}
          onValueChange={(v) => setTermsType(v as "revolving" | "installment")}
        >
          <SelectTrigger id="termsType" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="revolving">Revolving (credit card, line of credit)</SelectItem>
            <SelectItem value="installment">Installment (fixed loan)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <input type="hidden" name="effectiveDate" value={today} />

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="apr">Interest Rate % (optional)</Label>
          <Input
            id="apr"
            name="apr"
            type="number"
            step="0.01"
            min="0"
            defaultValue={currentTerms?.aprBps ? (currentTerms.aprBps / 100).toFixed(2) : ""}
          />
        </div>
        {termsType === "revolving" ? (
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="minPayment">Minimum Payment</Label>
            <Input
              id="minPayment"
              name="minPayment"
              type="number"
              step="0.01"
              min="0"
              defaultValue={
                currentTerms?.minPaymentCents ? (currentTerms.minPaymentCents / 100).toFixed(2) : ""
              }
            />
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="fixedPayment">Monthly Payment</Label>
            <Input
              id="fixedPayment"
              name="fixedPayment"
              type="number"
              step="0.01"
              min="0"
              defaultValue={
                currentTerms?.fixedPaymentCents
                  ? (currentTerms.fixedPaymentCents / 100).toFixed(2)
                  : ""
              }
            />
          </div>
        )}
      </div>

      {termsType === "installment" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="payoffTargetDate">Payoff Date (optional)</Label>
          <Input
            id="payoffTargetDate"
            name="payoffTargetDate"
            type="date"
            defaultValue={currentTerms?.payoffTargetDate ?? ""}
          />
        </div>
      )}

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="dueDay">Due day of month</Label>
          <Input
            id="dueDay"
            name="dueDay"
            type="number"
            min="1"
            max="31"
            defaultValue={currentTerms?.dueDay ?? ""}
          />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="servicerName">Servicer (optional)</Label>
          <Input
            id="servicerName"
            name="servicerName"
            defaultValue={currentTerms?.servicerName ?? ""}
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} size="sm" className="self-start">
        {pending ? "Saving…" : "Save Terms"}
      </Button>
    </form>
  );
}
