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
import {
  archivePerson,
  recordNetWorthSnapshot,
  unarchivePerson,
  updatePerson,
} from "@/server/actions/people";
import { formatCents } from "@/server/lib/money";
import { currentDateString } from "@/lib/month";
import { TrendDialog } from "@/components/accounts/TrendDialog";
import { PersonColorField } from "./PersonColorField";

const PERSON_TYPES = [
  { value: "adult", label: "Adult" },
  { value: "child", label: "Child" },
] as const;

function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

interface NetWorthPoint {
  asOfDate: string;
  assetsCents: number;
  liabilitiesCents: number;
}

export function EditPersonDialog({
  person,
  netWorthHistory = [],
  trigger,
  triggerClassName,
}: {
  person: {
    id: string;
    name: string;
    personType: string;
    color: string | null;
    isActive: boolean;
  };
  // Oldest-first, sparse (one row per year-end snapshot recorded, not one
  // per calendar year) - matches the append-only convention used elsewhere.
  netWorthHistory?: NetWorthPoint[];
  trigger: React.ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await updatePerson(person.id, formData);
        setOpen(false);
        return undefined;
      } catch {
        return "Couldn't save those changes — the name may already be in use.";
      }
    },
    undefined,
  );
  const [snapshotError, snapshotAction, snapshotPending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await recordNetWorthSnapshot(formData);
        return undefined;
      } catch {
        return "Couldn't record that snapshot.";
      }
    },
    undefined,
  );
  const today = currentDateString();
  const latest = netWorthHistory[netWorthHistory.length - 1];
  const netWorthSeries = netWorthHistory.map((p) => p.assetsCents - p.liabilitiesCents);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={triggerClassName}>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Person</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-person-name">Name</Label>
            <Input id="edit-person-name" name="name" defaultValue={person.name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-person-type">Type</Label>
            <Select
              name="personType"
              defaultValue={person.personType}
              items={Object.fromEntries(PERSON_TYPES.map((t) => [t.value, t.label]))}
            >
              <SelectTrigger id="edit-person-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERSON_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <PersonColorField defaultColor={person.color} idPrefix="edit-person" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>

        <div className="flex flex-col gap-3 border-t pt-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Net worth</div>
              {latest ? (
                <div className="text-lg font-semibold">
                  {formatCents(latest.assetsCents - latest.liabilitiesCents)}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No snapshots yet</div>
              )}
            </div>
            {netWorthHistory.length >= 2 && (
              <TrendDialog
                title={`${person.name}'s net worth`}
                points={netWorthHistory.map((p) => p.asOfDate)}
                series={netWorthSeries}
                changeLabel="since first snapshot"
                lastPointLabel={formatShortDate(latest.asOfDate)}
                trigger={
                  <span className="text-sm text-primary underline underline-offset-2">
                    View history
                  </span>
                }
              />
            )}
          </div>
          <form action={snapshotAction} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor={`net-worth-date-${person.id}`}>Record snapshot as of</Label>
              <p className="text-xs text-muted-foreground">Records net worth for everyone.</p>
              <Input
                id={`net-worth-date-${person.id}`}
                name="asOfDate"
                type="date"
                defaultValue={today}
                required
              />
            </div>
            <Button type="submit" variant="secondary" disabled={snapshotPending}>
              {snapshotPending ? "Recording…" : "Record"}
            </Button>
          </form>
          {snapshotError && <p className="text-sm text-destructive">{snapshotError}</p>}
        </div>

        {person.isActive ? (
          <form action={archivePerson.bind(null, person.id)} className="border-t pt-3">
            <button type="submit" className="text-sm text-muted-foreground hover:text-destructive">
              Archive person
            </button>
          </form>
        ) : (
          <form action={unarchivePerson.bind(null, person.id)} className="border-t pt-3">
            <button type="submit" className="text-sm text-muted-foreground hover:text-primary">
              Unarchive person
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
