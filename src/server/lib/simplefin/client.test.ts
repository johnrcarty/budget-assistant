import { describe, expect, it } from "vitest";

import { SimplefinRequestError, summarizeErrorBody } from "@/server/lib/simplefin/client";

describe("summarizeErrorBody", () => {
  it("reduces a Cloudflare HTML error page to its title", () => {
    const body = `<!DOCTYPE html><html><head><title>simplefin.org | 524: A timeout occurred</title>
      <meta charset="UTF-8" /></head><body><div id="cf-wrapper">lots of markup</div></body></html>`;
    expect(summarizeErrorBody(524, body)).toBe("524: A timeout occurred");
  });

  it("prefixes the status when the title doesn't already carry it", () => {
    expect(summarizeErrorBody(502, "<html><head><title>Bad Gateway</title></head></html>")).toBe(
      "502 Bad Gateway",
    );
  });

  it("keeps a short plain-text body on one line and truncates a long one", () => {
    expect(summarizeErrorBody(403, "  Forbidden\n  token revoked ")).toBe(
      "403 Forbidden token revoked",
    );
    const long = "x".repeat(500);
    const summary = summarizeErrorBody(500, long);
    expect(summary.length).toBeLessThan(220);
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("SimplefinRequestError.needsReconnect", () => {
  it("is true only for a rejected credential", () => {
    expect(new SimplefinRequestError("x", 401).needsReconnect).toBe(true);
    expect(new SimplefinRequestError("x", 403).needsReconnect).toBe(true);
    expect(new SimplefinRequestError("x", 524).needsReconnect).toBe(false);
    expect(new SimplefinRequestError("x", 503).needsReconnect).toBe(false);
    expect(new SimplefinRequestError("timeout", null).needsReconnect).toBe(false);
  });
});
