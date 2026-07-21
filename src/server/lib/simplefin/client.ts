import type { SimplefinAccountsResponse } from "@/types/simplefin";

// Setup Token -> claim URL is a one-time base64 decode. The claim itself is
// single-use (the resulting Access URL is what gets persisted, never the
// token), so this must be called exactly once per token.
export async function claimAccessUrl(setupToken: string): Promise<string> {
  const claimUrl = Buffer.from(setupToken.trim(), "base64").toString("utf8");

  const response = await fetch(claimUrl, { method: "POST" });
  if (!response.ok) {
    throw new Error(
      `SimpleFin claim failed: ${response.status} ${await response.text()}`,
    );
  }

  const accessUrl = (await response.text()).trim();
  if (!accessUrl.startsWith("http")) {
    throw new Error(
      `SimpleFin claim did not return a valid access URL. Got: ${JSON.stringify(accessUrl.slice(0, 200))}`,
    );
  }
  return accessUrl;
}

// The Access URL embeds Basic Auth credentials in its userinfo component.
// fetch() doesn't reliably send userinfo-embedded credentials itself, so
// they're extracted and sent as an explicit Authorization header instead.
function splitAccessUrl(accessUrl: string): { baseUrl: string; authHeader: string } {
  const url = new URL(accessUrl);
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  url.username = "";
  url.password = "";

  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    authHeader: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

export async function getSimplefinAccounts(
  accessUrl: string,
  opts: {
    startDate?: number;
    endDate?: number;
    pending?: boolean;
    balancesOnly?: boolean;
    accountIds?: string[];
  } = {},
): Promise<SimplefinAccountsResponse> {
  const { baseUrl, authHeader } = splitAccessUrl(accessUrl);
  const url = new URL(`${baseUrl}/accounts`);
  url.searchParams.set("version", "2");
  if (opts.startDate) url.searchParams.set("start-date", String(opts.startDate));
  if (opts.endDate) url.searchParams.set("end-date", String(opts.endDate));
  if (opts.pending) url.searchParams.set("pending", "1");
  if (opts.balancesOnly) url.searchParams.set("balances-only", "1");
  for (const id of opts.accountIds ?? []) {
    url.searchParams.append("account", id);
  }

  const response = await fetch(url, { headers: { Authorization: authHeader } });
  if (!response.ok) {
    throw new Error(
      `SimpleFin /accounts failed: ${response.status} ${await response.text()}`,
    );
  }

  return response.json();
}
