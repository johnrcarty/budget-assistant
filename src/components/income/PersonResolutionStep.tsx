"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NEW = "__new__";

export type PersonResolution =
  | { mode: "existing"; personId: string }
  | { mode: "new"; name: string };

// One row per distinct raw label detected in the CSV - map it to an
// existing Person or create a new one. This is the main place a
// spreadsheet's naming can diverge from what's already in Settings → People.
export function PersonResolutionStep({
  labels,
  persons,
  resolutions,
  onChange,
}: {
  labels: string[];
  persons: { id: string; name: string }[];
  resolutions: Record<string, PersonResolution>;
  onChange: (label: string, resolution: PersonResolution) => void;
}) {
  if (labels.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <Label>Match each name to a person</Label>
      {labels.map((label) => {
        const resolution = resolutions[label];
        const selectValue =
          resolution?.mode === "existing" ? resolution.personId : NEW;

        return (
          <div key={label} className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              &ldquo;{label}&rdquo; in the file
            </span>
            <div className="flex gap-2">
              <Select
                value={selectValue}
                onValueChange={(v) => {
                  if (!v) return;
                  if (v === NEW) onChange(label, { mode: "new", name: label });
                  else onChange(label, { mode: "existing", personId: v });
                }}
                items={{
                  ...Object.fromEntries(persons.map((p) => [p.id, p.name])),
                  [NEW]: "Create new person…",
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {persons.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW}>Create new person…</SelectItem>
                </SelectContent>
              </Select>
              {resolution?.mode === "new" && (
                <Input
                  value={resolution.name}
                  onChange={(e) => onChange(label, { mode: "new", name: e.target.value })}
                  aria-label={`New person name for ${label}`}
                  className="flex-1"
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
