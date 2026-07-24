import { IngressLink } from "@/components/layout/ingress";
import type { DateRangePreset } from "@/lib/date-range";

const SUMMARY_RANGES: { preset: DateRangePreset; label: string }[] = [
  { preset: "30d", label: "30D" },
  { preset: "90d", label: "90D" },
  { preset: "ytd", label: "YTD" },
  { preset: "1y", label: "1Y" },
  { preset: "lastyear", label: "Last year" },
  { preset: "all", label: "All" },
];

export function RangeChips({ active }: { active: DateRangePreset }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <div className="flex w-max gap-1 rounded-lg bg-muted p-1 text-sm font-medium">
        {SUMMARY_RANGES.map(({ preset, label }) => (
          <IngressLink
            key={preset}
            href={preset === "30d" ? "/summary" : `/summary?range=${preset}`}
            className={`rounded-md px-3 py-1.5 whitespace-nowrap ${
              preset === active
                ? "bg-secondary text-secondary-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            {label}
          </IngressLink>
        ))}
      </div>
    </div>
  );
}
