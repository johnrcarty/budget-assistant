// Identity from Home Assistant ingress. Supervisor adds the signed-in HA
// user to every request it proxies to an add-on's ingress port
// (supervisor/api/ingress.py, `_init_header`):
//
//   X-Remote-User-ID            stable HA user id
//   X-Remote-User-Name          HA username (may be absent)
//   X-Remote-User-Display-Name  HA display name (may be absent)
//
// Two layers decide whether those headers are believed:
//
// 1. nginx inside the add-on (ha-addon/rootfs/etc/nginx/http.d/ingress.conf)
//    forwards them ONLY when the client is Supervisor's ingress address,
//    and blanks them otherwise. Port 8099 is host-published for the MCP
//    endpoint, so without that any LAN client could forge an identity.
// 2. This module only reads them when HA_INGRESS_AUTH=1, which the add-on's
//    options bridge (10-options.sh) sets exclusively when running under
//    Supervisor. The plain Docker Compose deployment never sets it, so a
//    forged header there is inert regardless of what sits in front of it.
//
// No `server-only` on purpose: pure function of (headers, env), unit-tested.

export interface HaUser {
  id: string;
  username: string | null;
  displayName: string | null;
}

export const HA_USER_ID_HEADER = "x-remote-user-id";
export const HA_USER_NAME_HEADER = "x-remote-user-name";
export const HA_USER_DISPLAY_NAME_HEADER = "x-remote-user-display-name";

export function haIngressAuthEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.HA_INGRESS_AUTH === "1";
}

function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

// Returns the HA user behind this request, or null when the request didn't
// arrive through trusted ingress (no header, or trust not enabled).
export function readTrustedHaUser(
  headers: Headers,
  env: Record<string, string | undefined> = process.env,
): HaUser | null {
  if (!haIngressAuthEnabled(env)) return null;
  const id = nonEmpty(headers.get(HA_USER_ID_HEADER));
  if (!id) return null;
  return {
    id,
    username: nonEmpty(headers.get(HA_USER_NAME_HEADER)),
    displayName: nonEmpty(headers.get(HA_USER_DISPLAY_NAME_HEADER)),
  };
}
