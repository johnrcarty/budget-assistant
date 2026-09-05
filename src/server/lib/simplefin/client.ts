import type { SimplefinAccountsResponse } from "@/types/simplefin";

// Cloudflare fronts the SimpleFin bridge and gives the origin 100s before
// answering 524 itself; bailing out just short of that keeps a slow bridge
// from pinning a manual "Sync now" behind HA ingress for minutes.
export const REQUEST_TIMEOUT_MS = 90_000;

// A failed /accounts call, classified so the sync job can decide whether
// the connection needs the user (auth) or just a retry next sweep.
export class SimplefinRequestError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SimplefinRequestError";
    this.status = status;
  }

  // Only a rejected credential means the Access URL itself is dead and the
  // connection must be re-established. Everything else (5xx, Cloudflare
  // timeouts, network blips) is expected to clear on its own.
  get needsReconnect(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

// One readable line for an error body. Cloudflare and nginx error pages
// are full HTML documents - keep just their <title> ("524: A timeout
// occurred"), not the markup, since this lands verbatim on the settings
// screen and in sync_run.error_detail.
export function summarizeErrorBody(status: number, body: string): string {
  const trimmed = body.trim();
  const title = /<title>([^<]*)<\/title>/i.exec(trimmed)?.[1]?.trim();
  if (title) {
    // "simplefin.org | 524: A timeout occurred" -> "524: A timeout occurred"
    const withoutSite = title.replace(/^[^|]*\|\s*/, "");
    return withoutSite.startsWith(String(status)) ? withoutSite : `${status} ${withoutSite}`;
  }
  const oneLine = trimmed.replace(/\s+/g, " ");
  return oneLine.length > 200 ? `${status} ${oneLine.slice(0, 200)}…` : `${status} ${oneLine}`;
}

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

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? `no response within ${REQUEST_TIMEOUT_MS / 1000}s`
        : error instanceof Error
          ? error.message
          : String(error);
    throw new SimplefinRequestError(`SimpleFin /accounts failed: ${reason}`, null, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new SimplefinRequestError(
      `SimpleFin /accounts failed: ${summarizeErrorBody(response.status, await response.text())}`,
      response.status,
    );
  }

  return response.json();
}
