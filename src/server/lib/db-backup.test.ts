import { describe, expect, it } from "vitest";
import { dumpFilename, isPgCustomDump } from "./db-backup";

describe("dumpFilename", () => {
  it("matches the scheduled backup script's naming shape", () => {
    const date = new Date(Date.UTC(2026, 6, 24, 3, 5, 9));
    expect(dumpFilename(date)).toBe("monthly_budget_20260724T030509Z.dump");
  });
});

describe("isPgCustomDump", () => {
  it("accepts a pg_dump custom-format header", () => {
    expect(isPgCustomDump(new TextEncoder().encode("PGDMP\x01rest-of-archive"))).toBe(true);
  });

  it("rejects non-dump files", () => {
    expect(isPgCustomDump(new TextEncoder().encode("date,description,amount"))).toBe(false);
    expect(isPgCustomDump(new TextEncoder().encode("PGD"))).toBe(false);
    expect(isPgCustomDump(new Uint8Array())).toBe(false);
  });
});
