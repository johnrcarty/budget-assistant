// Clears the Auth.js session cookie and lands on /login. The DAL redirects
// here when a session's user has no household membership — i.e. the JWT
// outlived its user row, which is exactly what happens after restoring a
// backup taken on a different install (the restore replaces every user id).
// Without this, proxy.ts sees the stale cookie and bounces /login back to
// /summary, which 500s: the app is bricked until cookies are cleared by
// hand.
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  // Same ingress-prefix handling as proxy.ts: absent everywhere but true
  // HA ingress, where redirects must re-add Supervisor's stripped prefix.
  // Relative Location on purpose: behind nginx/ingress the app can't
  // reliably reconstruct the browser-facing absolute URL, and it doesn't
  // need to — browsers resolve a relative redirect against the current URL.
  const ingressPath = request.headers.get("x-ingress-path") ?? "";
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: `${ingressPath}/login` },
  });
  response.cookies.delete("authjs.session-token");
  response.cookies.delete("__Secure-authjs.session-token");
  return response;
}
