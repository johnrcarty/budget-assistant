import { describe, expect, it } from "vitest";

import { hasSignAction, resolveSignedAmount } from "@/lib/rule-match";

const tx = (description: string, accountId = "acct-1") => ({ description, accountId });

describe("resolveSignedAmount", () => {
  const inflow = {
    pattern: "DIRECT DEPOSIT",
    matchType: "starts_with" as const,
    accountId: "acct-1",
    forceInflow: true,
  };
  const outflow = {
    pattern: "DEBIT CARD PURCHASE",
    matchType: "starts_with" as const,
    accountId: "acct-1",
    forceOutflow: true,
  };

  it("forces a matching inflow positive and a matching outflow negative", () => {
    expect(resolveSignedAmount(-266953, tx("DIRECT DEPOSIT PAYROLL"), [inflow, outflow])).toBe(
      266953,
    );
    expect(resolveSignedAmount(1000, tx("DEBIT CARD PURCHASE STARBUCKS"), [inflow, outflow])).toBe(
      -1000,
    );
  });

  it("is a no-op when the feed's sign is already right (idempotent)", () => {
    expect(resolveSignedAmount(266953, tx("DIRECT DEPOSIT PAYROLL"), [inflow])).toBe(266953);
    expect(resolveSignedAmount(-1000, tx("DEBIT CARD PURCHASE STARBUCKS"), [outflow])).toBe(-1000);
  });

  it("ignores rows the rules don't match, and rules without a sign action", () => {
    expect(resolveSignedAmount(1000, tx("DIRECT DEBIT DPL"), [inflow, outflow])).toBe(1000);
    expect(resolveSignedAmount(1000, tx("DEBIT CARD PURCHASE", "acct-2"), [outflow])).toBe(1000);
    const plain = { pattern: "DEBIT CARD", matchType: "contains" as const };
    expect(resolveSignedAmount(1000, tx("DEBIT CARD PURCHASE"), [plain])).toBe(1000);
  });

  it("first matching sign rule wins", () => {
    const broad = { pattern: "DEBIT", matchType: "contains" as const, forceInflow: true };
    expect(resolveSignedAmount(1000, tx("DEBIT CARD PURCHASE"), [outflow, broad])).toBe(-1000);
    expect(resolveSignedAmount(1000, tx("DEBIT CARD PURCHASE"), [broad, outflow])).toBe(1000);
  });
});

describe("hasSignAction", () => {
  it("is true for either direction", () => {
    expect(hasSignAction({ forceInflow: true })).toBe(true);
    expect(hasSignAction({ forceOutflow: true })).toBe(true);
    expect(hasSignAction({ forceInflow: false, forceOutflow: false })).toBe(false);
    expect(hasSignAction({})).toBe(false);
  });
});
