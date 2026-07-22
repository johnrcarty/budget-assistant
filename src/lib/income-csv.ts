import { parseAmountToCents } from "./csv-import";

// Mapping/building logic for annual income CSV import. Two shapes:
// - "long": one row per entry (person, year, source, amount, taxes...)
// - "wide": one row per year with one amount column per person - the shape
//   of a typical income-by-year spreadsheet export.

export type IncomeCsvMode = "long" | "wide";

export interface IncomeCsvMapping {
  mode: IncomeCsvMode;
  yearColumn: number | null;
  // long mode
  personColumn: number | null;
  sourceColumn: number | null; // optional; defaultSource used when null/blank
  amountColumn: number | null;
  fedColumn: number | null;
  stateColumn: number | null;
  localColumn: number | null;
  medicareColumn: number | null;
  ssColumn: number | null;
  // wide mode: selected columns whose HEADER is the person's name and whose
  // cells are that person's amount for the row's year
  personColumns: number[];
}

export interface BuiltIncomeRow {
  person: string;
  year: number;
  source: string;
  amountCents: number;
  fedTaxCents: number | null;
  stateTaxCents: number | null;
  localTaxCents: number | null;
  medicareCents: number | null;
  socialSecurityCents: number | null;
}

const YEAR_HINTS = ["year", "tax year", "yr"];
const PERSON_HINTS = ["person", "name", "who", "earner"];
const AMOUNT_HINTS = ["amount", "gross", "income", "wages", "total"];
const SOURCE_HINTS = ["source", "type", "form"];

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

export function parseYear(raw: string): number | null {
  const match = raw.trim().match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

export function guessIncomeMapping(headers: string[], rows: string[][]): IncomeCsvMapping {
  const yearColumn = bestMatch(headers, YEAR_HINTS);
  const personColumn = bestMatch(headers, PERSON_HINTS);
  const amountColumn = bestMatch(headers, AMOUNT_HINTS);

  // Long shape needs an explicit person column; otherwise assume wide and
  // preselect columns that mostly parse as amounts.
  const mode: IncomeCsvMode = personColumn !== null && amountColumn !== null ? "long" : "wide";

  const personColumns: number[] = [];
  if (mode === "wide") {
    headers.forEach((_, index) => {
      if (index === yearColumn) return;
      const sample = rows.slice(0, 10).map((row) => row[index] ?? "");
      const filled = sample.filter((cell) => cell.trim() !== "");
      if (filled.length === 0) return;
      const parseable = filled.filter((cell) => parseAmountToCents(cell) !== null);
      if (parseable.length >= filled.length / 2) personColumns.push(index);
    });
  }

  return {
    mode,
    yearColumn,
    personColumn,
    sourceColumn: bestMatch(headers, SOURCE_HINTS),
    amountColumn,
    fedColumn: bestMatch(headers, ["fed", "federal"]),
    stateColumn: bestMatch(headers, ["state", "st tax"]),
    localColumn: bestMatch(headers, ["local"]),
    medicareColumn: bestMatch(headers, ["medicare"]),
    ssColumn: bestMatch(headers, ["social security", "ss tax", "oasdi"]),
    personColumns,
  };
}

function cellCents(row: string[], column: number | null): number | null {
  if (column === null) return null;
  const cents = parseAmountToCents(row[column] ?? "");
  return cents !== null && cents !== 0 ? Math.abs(cents) : null;
}

export function buildIncomeRows(
  headers: string[],
  rows: string[][],
  mapping: IncomeCsvMapping,
  defaultSource: string,
): { built: BuiltIncomeRow[]; skipped: number } {
  const built: BuiltIncomeRow[] = [];
  let skipped = 0;
  const source = defaultSource.trim().toLowerCase() || "w2";

  for (const row of rows) {
    const year = mapping.yearColumn !== null ? parseYear(row[mapping.yearColumn] ?? "") : null;
    if (year === null) {
      skipped += 1;
      continue;
    }

    if (mapping.mode === "long") {
      const person = mapping.personColumn !== null ? (row[mapping.personColumn] ?? "").trim() : "";
      const amountCents = cellCents(row, mapping.amountColumn);
      if (!person || amountCents === null) {
        skipped += 1;
        continue;
      }
      const rowSource =
        mapping.sourceColumn !== null ? (row[mapping.sourceColumn] ?? "").trim().toLowerCase() : "";
      built.push({
        person,
        year,
        source: rowSource || source,
        amountCents,
        fedTaxCents: cellCents(row, mapping.fedColumn),
        stateTaxCents: cellCents(row, mapping.stateColumn),
        localTaxCents: cellCents(row, mapping.localColumn),
        medicareCents: cellCents(row, mapping.medicareColumn),
        socialSecurityCents: cellCents(row, mapping.ssColumn),
      });
    } else {
      // Wide: blank/zero cells simply mean "no income that year" - not an
      // error, so they don't count as skipped.
      for (const column of mapping.personColumns) {
        const person = (headers[column] ?? "").trim();
        const amountCents = cellCents(row, column);
        if (!person || amountCents === null) continue;
        built.push({
          person,
          year,
          source,
          amountCents,
          fedTaxCents: null,
          stateTaxCents: null,
          localTaxCents: null,
          medicareCents: null,
          socialSecurityCents: null,
        });
      }
    }
  }

  return { built, skipped };
}
