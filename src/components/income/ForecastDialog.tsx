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
import { createForecast } from "@/server/actions/annual-income";

const MODELS = [
  {
    key: "pattern",
    label: "Growth pattern",
    hint: "Repeats a cycle of yearly growth rates from your latest actual year.",
  },
  {
    key: "linear_regression",
    label: "Linear regression",
    hint: "Fits a straight line through your actual years and extends it.",
  },
] as const;

export function ForecastDialog({
  years,
  trigger,
  triggerClassName,
}: {
  years: number[]; // years that have actual data, ascending
  trigger: React.ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<string>("pattern");
  const latestYear = years[years.length - 1];
  const [error, formAction, pending] = useActionState(
    async (_prevState: string | undefined, formData: FormData) => {
      try {
        await createForecast(formData);
        setOpen(false);
        return undefined;
      } catch (e) {
        // Server actions that redirect throw NEXT_REDIRECT - let it through.
        if (e && typeof e === "object" && "digest" in e) throw e;
        return "Couldn't create that forecast.";
      }
    },
    undefined,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={triggerClassName}>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Forecast</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Forecasts are saved snapshots — adding income later never changes an
          existing forecast, so you can see how projections made at different
          times compare against what actually happened.
        </p>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="forecast-name">Name</Label>
            <Input
              id="forecast-name"
              name="name"
              defaultValue={`Projection from ${latestYear}`}
              required
            />
          </div>

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="forecast-model">Model</Label>
              <Select
                name="model"
                value={model}
                onValueChange={(value) => setModel(value ?? "pattern")}
                items={Object.fromEntries(MODELS.map((m) => [m.key, m.label]))}
              >
                <SelectTrigger id="forecast-model" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.key} value={m.key}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="forecast-base">Based on data through</Label>
              <Select name="baseYear" defaultValue={String(latestYear)}>
                <SelectTrigger id="forecast-base" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...years].reverse().map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {MODELS.find((m) => m.key === model)?.hint}
          </p>

          {model === "pattern" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="forecast-rates">Growth rates % (repeating cycle)</Label>
              <Input id="forecast-rates" name="patternRates" defaultValue="3.5, 3.5, 3.5, 10" />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="forecast-horizon">Project through year</Label>
            <Input
              id="forecast-horizon"
              name="horizonYear"
              type="number"
              min={latestYear + 1}
              max="2300"
              defaultValue={latestYear + 30}
              required
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Computing…" : "Create Forecast"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
