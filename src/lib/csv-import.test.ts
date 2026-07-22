import { describe, expect, it } from "vitest";

import {
  guessColumnMapping,
  parseAmountToCents,
  parseCsvText,
  parseDateToIso,
} from "@/lib/csv-import";

describe("parseCsvText", () => {
  it("splits headers from rows", () => {
    const { headers, rows } = parseCsvText("Date,Description,Amount\n7/1/2026,Coffee,-4.50\n");
    expect(headers).toEqual(["Date", "Description", "Amount"]);
    expect(rows).toEqual([["7/1/2026", "Coffee", "-4.50"]]);
  });

  it("handles quoted fields containing commas and escaped quotes", () => {
    const { rows } = parseCsvText(
      'Date,Description,Amount\n7/1/2026,"ACME, INC. ""STORE""",-4.50',
    );
    expect(rows).toEqual([["7/1/2026", 'ACME, INC. "STORE"', "-4.50"]]);
  });

  it("skips empty lines", () => {
    const { rows } = parseCsvText("Date,Amount\n\n7/1/2026,1.00\n\n\n7/2/2026,2.00\n");
    expect(rows).toEqual([
      ["7/1/2026", "1.00"],
      ["7/2/2026", "2.00"],
    ]);
  });

  it("returns empty headers and rows for empty input", () => {
    expect(parseCsvText("")).toEqual({ headers: [], rows: [] });
  });
});

describe("guessColumnMapping", () => {
  it("maps a Chase-style export (exact multi-word hint beats partials)", () => {
    // "Post Date" also partial-matches "date"; the exact "transaction date"
    // hint must win over any partial match.
    const mapping = guessColumnMapping([
      "Transaction Date",
      "Post Date",
      "Description",
      "Category",
      "Type",
      "Amount",
    ]);
    expect(mapping).toEqual({
      dateColumn: 0,
      descriptionColumn: 2,
      amountMode: "single",
      amountColumn: 5,
      flipAmountSign: false,
      debitColumn: null,
      creditColumn: null,
    });
  });

  it("detects split debit/credit exports", () => {
    const mapping = guessColumnMapping(["Date", "Description", "Withdrawal", "Deposit"]);
    expect(mapping).toEqual({
      dateColumn: 0,
      descriptionColumn: 1,
      amountMode: "split",
      amountColumn: null,
      flipAmountSign: false,
      debitColumn: 2,
      creditColumn: 3,
    });
  });

  it("normalizes case and whitespace, falls back to partial matches", () => {
    const mapping = guessColumnMapping(["  POSTING DATE  ", "Payee Name", "Amt"]);
    expect(mapping.dateColumn).toBe(0);
    expect(mapping.descriptionColumn).toBe(1);
    expect(mapping.amountColumn).toBe(2);
    expect(mapping.amountMode).toBe("single");
  });

  it("stays in single mode when only one of debit/credit matches", () => {
    const mapping = guessColumnMapping(["Date", "Description", "Withdrawal"]);
    expect(mapping.amountMode).toBe("single");
    expect(mapping.debitColumn).toBe(2);
    expect(mapping.creditColumn).toBeNull();
  });

  it("returns nulls when nothing matches", () => {
    const mapping = guessColumnMapping(["Foo", "Bar"]);
    expect(mapping).toEqual({
      dateColumn: null,
      descriptionColumn: null,
      amountMode: "single",
      amountColumn: null,
      flipAmountSign: false,
      debitColumn: null,
      creditColumn: null,
    });
  });
});

describe("parseAmountToCents", () => {
  it("parses currency-formatted amounts", () => {
    expect(parseAmountToCents("$1,234.56")).toBe(123456);
  });

  it("parses plain negatives", () => {
    expect(parseAmountToCents("-12.34")).toBe(-1234);
  });

  it("treats parentheses as accounting negatives", () => {
    expect(parseAmountToCents("(45.00)")).toBe(-4500);
    expect(parseAmountToCents("($45.00)")).toBe(-4500);
  });

  it("keeps parenthesized amounts negative even with an inner minus", () => {
    expect(parseAmountToCents("(-45.00)")).toBe(-4500);
  });

  it("parses whole-dollar amounts", () => {
    expect(parseAmountToCents("12")).toBe(1200);
    expect(parseAmountToCents("1,234")).toBe(123400);
  });

  it("returns null for empty or whitespace input", () => {
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("   ")).toBeNull();
  });

  it("returns null for non-numeric garbage", () => {
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("12.34.56")).toBeNull();
    expect(parseAmountToCents("()")).toBeNull();
    expect(parseAmountToCents("1-2")).toBeNull();
    // "$ -" appears in spreadsheet exports as "no amount"
    expect(parseAmountToCents("$ -")).toBeNull();
  });
});

describe("parseDateToIso", () => {
  it("passes ISO dates through", () => {
    expect(parseDateToIso("2026-07-01")).toBe("2026-07-01");
  });

  it("takes the date prefix of ISO timestamps", () => {
    expect(parseDateToIso("2026-07-01T14:30:00Z")).toBe("2026-07-01");
  });

  it("converts US M/D/YYYY with zero-padding", () => {
    expect(parseDateToIso("7/4/2026")).toBe("2026-07-04");
    expect(parseDateToIso("07/04/2026")).toBe("2026-07-04");
  });

  it("expands two-digit years as 20YY (intentional: bank exports are recent)", () => {
    expect(parseDateToIso("07/04/26")).toBe("2026-07-04");
    expect(parseDateToIso("12/31/99")).toBe("2099-12-31");
  });

  it("rejects non-US orderings and garbage (deliberately no DD/MM guessing)", () => {
    expect(parseDateToIso("31-12-2026")).toBeNull();
    expect(parseDateToIso("")).toBeNull();
    expect(parseDateToIso("July 4, 2026")).toBeNull();
  });

  it("pins current behavior: no month/day range validation", () => {
    // Out-of-range components pass through; the import action's
    // z.iso.date() validation rejects them downstream.
    expect(parseDateToIso("13/45/2026")).toBe("2026-13-45");
  });
});
