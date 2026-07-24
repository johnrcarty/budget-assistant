"use client";

import { useIngressNavigate } from "@/components/layout/ingress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "none";

export function ForecastPicker({
  forecasts,
  selectedId,
}: {
  forecasts: { id: string; name: string; baseYear: number }[];
  selectedId: string | null;
}) {
  const navigate = useIngressNavigate();

  return (
    <Select
      value={selectedId ?? NONE}
      onValueChange={(value) => {
        if (value) navigate(`/income?forecast=${value}`);
      }}
      // base-ui Select shows the raw value (a UUID here) unless given an
      // items map - same fix as PR #18.
      items={{
        [NONE]: "Actuals only",
        ...Object.fromEntries(forecasts.map((f) => [f.id, `${f.name} (thru ${f.baseYear})`])),
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Actuals only</SelectItem>
        {forecasts.map((f) => (
          <SelectItem key={f.id} value={f.id}>
            {f.name} (thru {f.baseYear})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
