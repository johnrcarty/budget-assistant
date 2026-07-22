export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
  trailingZeroDisplay: "stripIfInteger",
});

// "$47K" / "$1.2M" style, for tight spots (chart axes, card subtitles).
export function formatCentsCompact(cents: number): string {
  return compactUsd.format(cents / 100);
}

export function dollarsToCents(dollars: string | number): number {
  const value = typeof dollars === "string" ? Number(dollars) : dollars;
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}
