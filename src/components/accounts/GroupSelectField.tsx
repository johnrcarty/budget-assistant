"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// The "Group" field shared by Add/Edit account dialogs. Submits
// accountGroupId ("none" | uuid | "__new__") and, when creating, a
// newGroupName - decoded server-side by resolveAccountGroupId.
export function GroupSelectField({
  groups,
  defaultGroupId,
  idPrefix,
}: {
  groups: { id: string; name: string }[];
  defaultGroupId?: string | null;
  idPrefix: string;
}) {
  const [value, setValue] = useState(defaultGroupId ?? "none");

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${idPrefix}-group`}>Group</Label>
      <Select
        name="accountGroupId"
        value={value}
        onValueChange={(v) => v && setValue(v)}
        items={{
          none: "None",
          ...Object.fromEntries(groups.map((g) => [g.id, g.name])),
          __new__: "New group…",
        }}
      >
        <SelectTrigger id={`${idPrefix}-group`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          {groups.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.name}
            </SelectItem>
          ))}
          <SelectItem value="__new__">New group…</SelectItem>
        </SelectContent>
      </Select>
      {value === "__new__" && (
        <Input
          name="newGroupName"
          placeholder="Group name"
          required
          aria-label="New group name"
        />
      )}
    </div>
  );
}
