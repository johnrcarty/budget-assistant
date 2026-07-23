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
import { saveIncomeSchedule } from "@/server/actions/income-schedules";
import type { PayFrequency } from "@/lib/income-schedule";

const FREQUENCIES: Record<PayFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  semimonthly: "Semi-monthly",
  monthly: "Monthly",
  irregular: "Irregular",
};

export interface ScheduleInitialValues {
  frequency: PayFrequency;
  anchorDate: string | null;
  secondDayOfMonth: number | null;
  perCheckAmount: string; // dollars, e.g. "2669.52"
}

export function EditIncomeScheduleDialog({
  personId,
  groupLabel,
  month,
  initial,
  trigger,
  triggerClassName,
}: {
  personId: string;
  groupLabel: string;
  month: string;
  initial?: ScheduleInitialValues;
  trigger: React.ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [frequency, setFrequency] = useState<PayFrequency>(
    initial?.frequency ?? "biweekly",
  );
  const [error, formAction, pending] = useActionState(
    async (_prev: string | undefined, formData: FormData) => {
      try {
        await saveIncomeSchedule(formData);
        setOpen(false);
        return undefined;
      } catch {
        return "Couldn't save that schedule. Check the date and amount.";
      }
    },
    undefined,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={triggerClassName}>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{groupLabel} pay schedule</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="personId" value={personId} />
          <input type="hidden" name="month" value={month} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="schedule-frequency">Frequency</Label>
            <Select
              name="frequency"
              value={frequency}
              onValueChange={(value) => setFrequency(value as PayFrequency)}
              items={FREQUENCIES}
            >
              <SelectTrigger id="schedule-frequency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FREQUENCIES).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {frequency !== "irregular" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="schedule-anchor">
                {frequency === "semimonthly" ? "First pay date" : "A known check date"}
              </Label>
              <Input
                id="schedule-anchor"
                name="anchorDate"
                type="date"
                defaultValue={initial?.anchorDate ?? undefined}
                required
              />
              {(frequency === "weekly" || frequency === "biweekly") && (
                <p className="text-xs text-muted-foreground">
                  Any past or future payday works - the rest of the schedule is
                  counted from it.
                </p>
              )}
            </div>
          )}

          {frequency === "semimonthly" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="schedule-second-day">Second pay day of month</Label>
              <Input
                id="schedule-second-day"
                name="secondDayOfMonth"
                type="number"
                min="1"
                max="31"
                defaultValue={initial?.secondDayOfMonth ?? undefined}
                required
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="schedule-amount">Amount per check</Label>
            <Input
              id="schedule-amount"
              name="perCheckAmount"
              type="number"
              step="0.01"
              min="0"
              defaultValue={initial?.perCheckAmount ?? "0"}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save Schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
