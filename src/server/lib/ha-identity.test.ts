import { describe, expect, it } from "vitest";

import { readTrustedHaUser } from "@/server/lib/ha-identity";

const ON = { HA_INGRESS_AUTH: "1" };
const OFF = {};

describe("readTrustedHaUser", () => {
  it("returns the HA user when trust is enabled and the id header is present", () => {
    const headers = new Headers({
      "X-Remote-User-ID": "abc123",
      "X-Remote-User-Name": "natasha",
      "X-Remote-User-Display-Name": "Natasha",
    });
    expect(readTrustedHaUser(headers, ON)).toEqual({
      id: "abc123",
      username: "natasha",
      displayName: "Natasha",
    });
  });

  it("tolerates missing optional name headers", () => {
    const headers = new Headers({ "X-Remote-User-ID": "abc123" });
    expect(readTrustedHaUser(headers, ON)).toEqual({
      id: "abc123",
      username: null,
      displayName: null,
    });
  });

  it("ignores the headers entirely when HA_INGRESS_AUTH is not set", () => {
    const headers = new Headers({ "X-Remote-User-ID": "abc123" });
    expect(readTrustedHaUser(headers, OFF)).toBeNull();
    expect(readTrustedHaUser(headers, { HA_INGRESS_AUTH: "true" })).toBeNull();
  });

  it("treats a blank id (what nginx sends for untrusted clients) as no identity", () => {
    const headers = new Headers({ "X-Remote-User-ID": "   " });
    expect(readTrustedHaUser(headers, ON)).toBeNull();
    expect(readTrustedHaUser(new Headers(), ON)).toBeNull();
  });
});
