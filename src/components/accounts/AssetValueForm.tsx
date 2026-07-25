"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addAssetValueSnapshot, setAssetPurchasePrice } from "@/server/actions/accounts";
import { formatCents } from "@/server/lib/money";
import { currentDateString } from "@/lib/month";

// Manual value updates for physical assets (property/vehicle) - the asset
// analog of DebtBalanceForm. Each save writes a dated snapshot, so the
// account's trend line tracks appreciation over time.
export function AssetValueForm({
  accountId,
  currentBalanceCents,
  originalBalanceCents,
}: {
  accountId: string;
  currentBalanceCents: number | null;
  originalBalanceCents: number | null;
}) {
  const today = currentDateString();
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await addAssetValueSnapshot(accountId, formData);
        return undefined;
      } catch {
        return "Couldn't save that value.";
      }
    },
    undefined,
  );
  const [priceError, priceAction, pricePending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await setAssetPurchasePrice(accountId, formData);
        return undefined;
      } catch {
        return "Couldn't save the purchase price.";
      }
    },
    undefined,
  );

  const appreciationCents =
    originalBalanceCents !== null && currentBalanceCents !== null
      ? currentBalanceCents - originalBalanceCents
      : null;

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="asset-value">Current value</Label>
            <Input
              id="asset-value"
              name="value"
              type="number"
              step="0.01"
              min="0"
              required
              defaultValue={
                currentBalanceCents !== null
                  ? (currentBalanceCents / 100).toFixed(2)
                  : undefined
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="asset-value-date">As of</Label>
            <Input
              id="asset-value-date"
              name="asOfDate"
              type="date"
              defaultValue={today}
              required
            />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending} size="sm" className="self-start">
          {pending ? "Saving…" : "Update Value"}
        </Button>
      </form>

      {originalBalanceCents !== null ? (
        <p className="text-xs text-muted-foreground">
          Purchased for {formatCents(originalBalanceCents)}
          {appreciationCents !== null && (
            <>
              {" · "}
              <span
                className={appreciationCents < 0 ? "text-destructive" : "text-primary"}
              >
                {appreciationCents >= 0 ? "up " : "down "}
                {formatCents(Math.abs(appreciationCents))}
              </span>{" "}
              since purchase
            </>
          )}
        </p>
      ) : (
        <form action={priceAction} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="asset-purchase-price" className="text-xs">
              Purchase price (optional)
            </Label>
            <Input
              id="asset-purchase-price"
              name="purchasePrice"
              type="number"
              step="0.01"
              min="0"
              required
            />
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={pricePending}>
            {pricePending ? "Saving…" : "Save"}
          </Button>
          {priceError && <p className="text-sm text-destructive">{priceError}</p>}
        </form>
      )}
    </div>
  );
}
