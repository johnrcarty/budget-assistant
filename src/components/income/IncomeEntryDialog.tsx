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
import { deleteIncomeEntry, saveIncomeEntry } from "@/server/actions/annual-income";
import type { AnnualIncomeEntry, IncomePersonSummary } from "@/server/db/queries/annual-income";

const SOURCE_SUGGESTIONS = ["w2", "1099", "k1", "self-employed", "interest", "other"];

const TAX_FIELDS = [
  { name: "fedTax", label: "Federal tax", key: "fedTaxCents" },
  { name: "stateTax", label: "State tax", key: "stateTaxCents" },
  { name: "localTax", label: "Local tax", key: "localTaxCents" },
  { name: "medicare", label: "Medicare", key: "medicareCents" },
  { name: "socialSecurity", label: "Social Security", key: "socialSecurityCents" },
] as const;

function centsToInput(cents: number | null | undefined): string {
  return cents != null ? (cents / 100).toFixed(2) : "";
}

export function IncomeEntryDialog({
  entry,
  persons,
  defaultYear,
  trigger,
  triggerClassName,
}: {
  entry?: AnnualIncomeEntry;
  persons: IncomePersonSummary[];
  defaultYear: number;
  trigger: React.ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const isEdit = entry !== undefined;
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await saveIncomeEntry(entry?.id ?? null, formData);
        setOpen(false);
        return undefined;
      } catch {
        return "Couldn't save that entry.";
      }
    },
    undefined,
  );

  if (persons.length === 0) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger className={triggerClassName}>{trigger}</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Income" : "Add Income"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Add a person in Settings → People first, then come back to record income.
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={triggerClassName}>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Income" : "Add Income"}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="income-person">Person</Label>
              <Select name="personId" defaultValue={entry?.personId ?? persons[0].id}>
                <SelectTrigger id="income-person" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {persons.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-28 flex-col gap-2">
              <Label htmlFor="income-year">Year</Label>
              <Input
                id="income-year"
                name="year"
                type="number"
                min="1900"
                max="2200"
                defaultValue={entry?.year ?? defaultYear}
                required
              />
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="income-source">Source</Label>
              <Input
                id="income-source"
                name="source"
                list="income-sources"
                defaultValue={entry?.source ?? "w2"}
                required
              />
              <datalist id="income-sources">
                {SOURCE_SUGGESTIONS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="income-amount">Gross amount</Label>
              <Input
                id="income-amount"
                name="amount"
                type="number"
                step="0.01"
                min="0"
                defaultValue={centsToInput(entry?.amountCents)}
                required
              />
            </div>
          </div>

          <details open={isEdit && TAX_FIELDS.some((f) => entry?.[f.key] != null)}>
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Withholdings (optional)
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {TAX_FIELDS.map((field) => (
                <div key={field.name} className="flex flex-col gap-2">
                  <Label htmlFor={`income-${field.name}`}>{field.label}</Label>
                  <Input
                    id={`income-${field.name}`}
                    name={field.name}
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={centsToInput(entry?.[field.key])}
                  />
                </div>
              ))}
            </div>
          </details>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : isEdit ? "Save" : "Add Income"}
            </Button>
          </DialogFooter>
        </form>

        {isEdit && (
          <form action={deleteIncomeEntry.bind(null, entry.id)} className="border-t pt-3">
            <button
              type="submit"
              className="text-sm text-muted-foreground hover:text-destructive"
            >
              Delete entry
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
