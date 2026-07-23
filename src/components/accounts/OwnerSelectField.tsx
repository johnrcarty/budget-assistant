"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// Multi-select owner picker shared by Add/Edit account dialogs. 0 checked =
// unassigned/shared, 1 = individual, 2+ = joint - accountOwners rows are
// resynced wholesale from whichever ids are checked on submit.
export function OwnerSelectField({
  persons,
  defaultOwnerIds = [],
  idPrefix,
}: {
  persons: { id: string; name: string }[];
  defaultOwnerIds?: string[];
  idPrefix: string;
}) {
  const [checked, setChecked] = useState(new Set(defaultOwnerIds));

  if (persons.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <Label>Owner</Label>
      <div className="flex flex-col gap-2">
        {persons.map((person) => (
          <label
            key={person.id}
            htmlFor={`${idPrefix}-owner-${person.id}`}
            className="flex items-center gap-2 text-sm"
          >
            <Checkbox
              id={`${idPrefix}-owner-${person.id}`}
              name="ownerPersonIds"
              value={person.id}
              checked={checked.has(person.id)}
              onCheckedChange={(v) =>
                setChecked((prev) => {
                  const next = new Set(prev);
                  if (v) next.add(person.id);
                  else next.delete(person.id);
                  return next;
                })
              }
            />
            {person.name}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Leave everyone unchecked for a shared/household account. Check two or more for
        a joint account.
      </p>
    </div>
  );
}
