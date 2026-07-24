import { headers } from "next/headers";

// Under Home Assistant ingress, Supervisor strips its dynamic
// `/api/hassio_ingress/<token>` prefix before forwarding a request, and
// sends the stripped prefix back via X-Ingress-Path so server-built URLs
// (redirects, hrefs) can re-apply it. Empty string for the plain
// LAN/Docker Compose deployment, so behavior there is unchanged.
// Same convention as src/proxy.ts and src/server/actions/auth.ts.
export async function getIngressPath(): Promise<string> {
  return (await headers()).get("x-ingress-path") ?? "";
}
