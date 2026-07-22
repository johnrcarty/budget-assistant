import { describe, expect, it } from "vitest";

import { dollarsToCents, formatCents, formatCentsCompact } from "@/server/lib/money";

describe("formatCents", () => {
  it("formats cents as USD", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
  });

  it("formats zero", () => {
    expect(formatCents(0)).toBe("$0.00");
  });

  it("formats a single cent", () => {
    expect(formatCents(1)).toBe("$0.01");
  });

  it("formats negative amounts", () => {
    expect(formatCents(-100)).toBe("-$1.00");
  });

  it("groups large amounts", () => {
    expect(formatCents(123456789012)).toBe("$1,234,567,890.12");
  });
});

describe("formatCentsCompact", () => {
  it("compacts thousands without a trailing zero", () => {
    expect(formatCentsCompact(4_700_000)).toBe("$47K");
  });

  it("compacts millions with one fraction digit", () => {
    expect(formatCentsCompact(123_456_789)).toBe("$1.2M");
  });

  it("keeps whole-K amounts integer via stripIfInteger", () => {
    expect(formatCentsCompact(200_000)).toBe("$2K");
  });

  it("rounds sub-$1000 amounts to one fraction digit", () => {
    expect(formatCentsCompact(12345)).toBe("$123.5");
  });

  it("handles negatives", () => {
    expect(formatCentsCompact(-4_700_000)).toBe("-$47K");
  });
});

describe("dollarsToCents", () => {
  it("parses decimal strings", () => {
    expect(dollarsToCents("12.34")).toBe(1234);
  });

  it("parses negative strings", () => {
    expect(dollarsToCents("-12.34")).toBe(-1234);
  });

  it("accepts numbers", () => {
    expect(dollarsToCents(19.99)).toBe(1999);
  });

  it("rounds float-precision artifacts", () => {
    // 19.99 * 100 === 1998.9999999999998 in IEEE-754
    expect(dollarsToCents("19.99")).toBe(1999);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
  });

  it("accepts scientific notation strings (Number() semantics)", () => {
    expect(dollarsToCents("1e2")).toBe(10000);
  });

  it("returns 0 for non-finite input", () => {
    expect(dollarsToCents("abc")).toBe(0);
    expect(dollarsToCents(Number.NaN)).toBe(0);
    expect(dollarsToCents(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("returns 0 for the empty string (Number('') === 0)", () => {
    expect(dollarsToCents("")).toBe(0);
  });
});
