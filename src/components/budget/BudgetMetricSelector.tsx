"use client";

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DISPLAY_MODES, type DisplayMode } from "./display-mode";

// Compact replacement for the old full-width Planned/Spent/Remaining tabs.
export function BudgetMetricSelector({
  value,
  onChange,
}: {
  value: DisplayMode;
  onChange: (mode: DisplayMode) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 text-xs font-medium tracking-wide uppercase">
        <span className="text-muted-foreground">Show:</span>
        <span className="text-primary">{value}</span>
        <ChevronDown className="size-3.5 text-primary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => onChange(v as DisplayMode)}
        >
          {DISPLAY_MODES.map((mode) => (
            <DropdownMenuRadioItem
              key={mode}
              value={mode}
              // Base UI radio items keep the menu open by default; this is a
              // pick-one-and-done control, so close on selection.
              closeOnClick
              className="capitalize"
            >
              {mode}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
