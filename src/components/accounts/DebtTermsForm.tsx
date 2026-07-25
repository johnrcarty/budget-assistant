"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addDebtTermsVersion } from "@/server/actions/debt";
import { currentDateString } from "@/lib/month";
import {
  PERIODS_PER_YEAR,
  monthlyEquivalentCents,
  type PaymentFrequency,
} from "@/server/lib/debt-sim";
import type { debtTermsVersions } from "@/server/db/schema";

const FREQUENCY_LABELS: Record<PaymentFrequency, string> = {
  monthly: "Monthly",
  semimonthly: "Twice a month",
  biweekly: "Every 2 weeks",
  weekly: "Weekly",
};

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
  const [frequency, setFrequency] = useState<PaymentFrequency>(
    currentTerms?.paymentFrequency ?? "monthly",
  );
  const [isPercentMin, setIsPercentMin] = useState(
    currentTerms?.minPaymentIsPercent ?? false,
  );
  const [paymentInput, setPaymentInput] = useState(() => {
    const cents =
      currentTerms?.termsType === "installment"
        ? currentTerms?.fixedPaymentCents
        : currentTerms?.minPaymentCents;
    return cents ? (cents / 100).toFixed(2) : "";
  });
  const today = currentDateString();
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

  const paymentCents = Math.round(Number(paymentInput || "0") * 100);
  const showMonthlyHint =
    frequency !== "monthly" && !isPercentMin && paymentCents > 0;
  const perPaymentSuffix = frequency === "monthly" ? "" : " (per payment)";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Saving here records a new terms change effective today - past terms stay
        on the record for whatever period they applied to.
      </p>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="termsType">Type</Label>
          <Select
            name="termsType"
            value={termsType}
            onValueChange={(v) => setTermsType(v as "revolving" | "installment")}
            items={{
              revolving: "Revolving (credit card, line of credit)",
              installment: "Installment (fixed loan)",
            }}
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
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="paymentFrequency">Payment frequency</Label>
          <Select
            name="paymentFrequency"
            value={frequency}
            onValueChange={(v) => setFrequency(v as PaymentFrequency)}
            items={FREQUENCY_LABELS}
          >
            <SelectTrigger id="paymentFrequency" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FREQUENCY_LABELS) as PaymentFrequency[]).map((f) => (
                <SelectItem key={f} value={f}>
                  {FREQUENCY_LABELS[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <input type="hidden" name="effectiveDate" value={today} />
      <input type="hidden" name="minPaymentIsPercent" value={isPercentMin ? "true" : "false"} />

      {termsType === "revolving" && (
        <div className="flex items-center gap-2">
          <Switch
            id="percentMin"
            checked={isPercentMin}
            onCheckedChange={setIsPercentMin}
          />
          <Label htmlFor="percentMin">Minimum is % of balance</Label>
        </div>
      )}

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
          isPercentMin ? (
            // Distinct keys below keep React from reconciling the swapped
            // payment inputs into each other (controlled <-> uncontrolled).
            <div key="min-percent" className="flex flex-1 flex-col gap-2">
              <Label htmlFor="minPaymentPercent">Minimum % of balance</Label>
              <Input
                id="minPaymentPercent"
                name="minPaymentPercent"
                type="number"
                step="0.01"
                min="0"
                defaultValue={
                  currentTerms?.minPaymentPercentBps
                    ? (currentTerms.minPaymentPercentBps / 100).toFixed(2)
                    : ""
                }
              />
            </div>
          ) : (
            <div key="min-plain" className="flex flex-1 flex-col gap-2">
              <Label htmlFor="minPayment">Minimum Payment{perPaymentSuffix}</Label>
              <Input
                id="minPayment"
                name="minPayment"
                type="number"
                step="0.01"
                min="0"
                value={paymentInput}
                onChange={(e) => setPaymentInput(e.target.value)}
              />
            </div>
          )
        ) : (
          <div key="fixed" className="flex flex-1 flex-col gap-2">
            <Label htmlFor="fixedPayment">
              {frequency === "monthly" ? "Monthly Payment" : "Payment (per payment)"}
            </Label>
            <Input
              id="fixedPayment"
              name="fixedPayment"
              type="number"
              step="0.01"
              min="0"
              value={paymentInput}
              onChange={(e) => setPaymentInput(e.target.value)}
            />
          </div>
        )}
      </div>

      {termsType === "revolving" && isPercentMin && (
        <div key="min-floor" className="flex flex-col gap-2">
          <Label htmlFor="minPayment">Minimum floor $ (optional)</Label>
          <Input
            id="minPayment"
            name="minPayment"
            type="number"
            step="0.01"
            min="0"
            defaultValue={
              currentTerms?.minPaymentCents
                ? (currentTerms.minPaymentCents / 100).toFixed(2)
                : ""
            }
          />
        </div>
      )}

      {showMonthlyHint && (
        <p className="text-xs text-muted-foreground">
          ≈ ${(monthlyEquivalentCents(paymentCents, frequency) / 100).toFixed(2)}/month
          ({PERIODS_PER_YEAR[frequency]} payments a year)
        </p>
      )}

      {termsType === "installment" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="escrow">Escrow included in payment{perPaymentSuffix} (optional)</Label>
          <Input
            id="escrow"
            name="escrow"
            type="number"
            step="0.01"
            min="0"
            defaultValue={
              currentTerms?.escrowCents ? (currentTerms.escrowCents / 100).toFixed(2) : ""
            }
          />
          <p className="text-xs text-muted-foreground">
            Taxes, insurance, PMI — still budgeted, but excluded from payoff math.
          </p>
        </div>
      )}

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
        {frequency === "monthly" && (
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
        )}
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
