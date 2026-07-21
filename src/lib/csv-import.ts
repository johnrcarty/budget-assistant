import Papa from "papaparse";

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsvText(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text.trim(), {
    skipEmptyLines: true,
  });
  const [headers, ...rows] = result.data;
  return { headers: headers ?? [], rows };
}

export type AmountMode = "single" | "split";

export interface ColumnMapping {
  dateColumn: number | null;
  descriptionColumn: number | null;
  amountMode: AmountMode;
  // single mode
  amountColumn: number | null;
  flipAmountSign: boolean;
  // split mode
  debitColumn: number | null;
  creditColumn: number | null;
}

const DATE_HINTS = ["date", "posted", "transaction date", "trans date"];
const DESCRIPTION_HINTS = ["description", "memo", "payee", "name", "merchant", "details"];
const AMOUNT_HINTS = ["amount", "amt"];
const DEBIT_HINTS = ["debit", "withdrawal", "money out", "out"];
const CREDIT_HINTS = ["credit", "deposit", "money in", "in"];

function bestMatch(headers: string[], hints: string[]): number | null {
  const normalized = headers.map((h) => h.trim().toLowerCase());

  for (const hint of hints) {
    const exact = normalized.indexOf(hint);
    if (exact !== -1) return exact;
  }
  for (const hint of hints) {
    const partial = normalized.findIndex((h) => h.includes(hint));
    if (partial !== -1) return partial;
  }
  return null;
}

export function guessColumnMapping(headers: string[]): ColumnMapping {
  const debitColumn = bestMatch(headers, DEBIT_HINTS);
  const creditColumn = bestMatch(headers, CREDIT_HINTS);
  const hasSplit = debitColumn !== null && creditColumn !== null;

  return {
    dateColumn: bestMatch(headers, DATE_HINTS),
    descriptionColumn: bestMatch(headers, DESCRIPTION_HINTS),
    amountMode: hasSplit ? "split" : "single",
    amountColumn: hasSplit ? null : bestMatch(headers, AMOUNT_HINTS),
    flipAmountSign: false,
    debitColumn,
    creditColumn,
  };
}

// Accepts "$1,234.56", "-12.34", "(45.00)" (accounting negative), "12.34".
export function parseAmountToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const isParenNegative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[()$,\s]/g, "");
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

  const cents = Math.round(value * 100);
  return isParenNegative ? -Math.abs(cents) : cents;
}

// Normalizes common export formats (M/D/YYYY, YYYY-MM-DD, M/D/YY) to
// YYYY-MM-DD. Deliberately doesn't guess DD/MM/YYYY - too ambiguous to
// auto-detect reliably against the far more common US M/D/YYYY.
export function parseDateToIso(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (usMatch) {
    const [, m, d, y] = usMatch;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return null;
}
