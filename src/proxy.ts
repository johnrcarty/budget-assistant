import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Optimistic check only: reads the JWT session cookie, does not hit the
// database. Real authorization happens in the DAL (server/lib/dal.ts) close
// to the data. See Next.js's auth guide for why Proxy alone isn't sufficient.
const PUBLIC_PATHS = ["/login"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  const hasSessionCookie =
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token");

  // Under Home Assistant ingress, Supervisor strips its dynamic
  // `/api/hassio_ingress/<token>` prefix before forwarding the request here,
  // so `request.url` never contains it - an absolute redirect built from
  // the bare path would send the browser to HA's own frontend route instead
  // of back through the ingress proxy. Supervisor forwards the stripped
  // prefix via X-Ingress-Path precisely so it can be re-added here; this
  // header is absent for the plain LAN/Docker Compose deployment, so the
  // prefix is empty and behavior there is unchanged.
  const ingressPath = request.headers.get("x-ingress-path") ?? "";

  if (!isPublic && !hasSessionCookie) {
    return NextResponse.redirect(new URL(`${ingressPath}/login`, request.url));
  }

  if (pathname === "/login" && hasSessionCookie) {
    return NextResponse.redirect(new URL(`${ingressPath}/summary`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\.png$|manifest.json).*)"],
};
