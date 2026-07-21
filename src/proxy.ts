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

  if (!isPublic && !hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname === "/login" && hasSessionCookie) {
    return NextResponse.redirect(new URL("/summary", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\.png$|manifest.json).*)"],
};
