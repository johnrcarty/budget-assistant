"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const CHART_COLORS = Array.from({ length: 8 }, (_, i) => `chart-${i + 1}`);

// Swatch picker over the shared --chart-N theme tokens (not raw hex) so a
// person's color stays consistent with every chart/legend and adapts to
// light/dark automatically.
export function PersonColorField({
  defaultColor,
  idPrefix,
}: {
  defaultColor?: string | null;
  idPrefix: string;
}) {
  const [color, setColor] = useState(defaultColor ?? "");

  return (
    <div className="flex flex-col gap-2">
      <Label>Color</Label>
      <input type="hidden" name="color" value={color} />
      <div className="flex flex-wrap gap-2">
        {CHART_COLORS.map((token) => (
          <button
            key={token}
            type="button"
            aria-label={token}
            aria-pressed={color === token}
            onClick={() => setColor((prev) => (prev === token ? "" : token))}
            className={cn(
              "size-7 rounded-full border-2 transition-transform",
              color === token ? "scale-110 border-foreground" : "border-transparent",
            )}
            style={{ backgroundColor: `var(--${token})` }}
            id={`${idPrefix}-color-${token}`}
          />
        ))}
      </div>
    </div>
  );
}
