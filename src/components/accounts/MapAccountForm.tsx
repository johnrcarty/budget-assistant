"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mapConnectionAccount } from "@/server/actions/simplefin";
import { formatCents } from "@/server/lib/money";
import type { accounts } from "@/server/db/schema";

// Deliberately narrower than the global ACCOUNT_KINDS list: only kinds a
// bank feed can plausibly be. Property/vehicle values are manual-only and
// must never be mapped to a SimpleFin account.
const ACCOUNT_KINDS = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit_card", label: "Credit Card" },
  { value: "loan", label: "Loan" },
  { value: "line_of_credit", label: "Line of Credit" },
  { value: "other", label: "Other" },
] as const;

export function MapAccountForm({
  connectionAccountId,
  simplefinAccountName,
  balanceCents,
  existingAccounts,
}: {
  connectionAccountId: string;
  simplefinAccountName: string;
  balanceCents: number | null;
  existingAccounts: (typeof accounts.$inferSelect)[];
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await mapConnectionAccount(connectionAccountId, formData);
        return undefined;
      } catch {
        return "Couldn't link that account.";
      }
    },
    undefined,
  );

  return (
    <div className="flex flex-col gap-3 border-b py-4 last:border-b-0">
      <div className="flex items-center justify-between">
        <span className="font-medium">{simplefinAccountName}</span>
        <span className="text-sm text-muted-foreground">
          {balanceCents !== null ? formatCents(balanceCents) : "—"}
        </span>
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="mode" value={mode} />
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={mode === "new"}
              onChange={() => setMode("new")}
            />
            New account
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
            />
            Link existing
          </label>
        </div>

        {mode === "new" ? (
          <div className="flex gap-2">
            <Input name="newAccountName" placeholder="Account name" required />
            <Select name="newAccountKind" defaultValue="checking">
              <SelectTrigger className="w-40">
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
        ) : (
          <Select
            name="existingAccountId"
            items={Object.fromEntries(existingAccounts.map((a) => [a.id, a.name]))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select an account" />
            </SelectTrigger>
            <SelectContent>
              {existingAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending} size="sm" className="self-start">
          {pending ? "Linking…" : "Link"}
        </Button>
      </form>
    </div>
  );
}
