import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/lib/auth";
import { readTrustedHaUser } from "@/server/lib/ha-identity";
import { getMembershipForUser, resolveHaUser, type MemberRole } from "@/server/db/queries/members";
import { getIngressPath } from "@/server/lib/ingress";

export type ViewerIdentity = {
  userId: string;
  // "home-assistant": trusted ingress header (see ha-identity.ts).
  // "credentials": the Auth.js JWT from the email/password fallback login.
  source: "home-assistant" | "credentials";
};

// Who is making this request. Under HA ingress that's the HA user
// Supervisor tells us about, provisioned on first sight; otherwise the
// Auth.js session. Redirects to /login when neither identifies anyone.
export const getViewerIdentity = cache(async (): Promise<ViewerIdentity> => {
  const haUser = readTrustedHaUser(await headers());
  if (haUser) {
    const { userId } = await resolveHaUser(haUser);
    return { userId, source: "home-assistant" };
  }

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`${await getIngressPath()}/login`);
  }
  return { userId: session.user.id, source: "credentials" };
});

export const verifySession = cache(async () => {
  const { userId } = await getViewerIdentity();
  return { userId };
});

export type CurrentMembership = ViewerIdentity & {
  householdId: string;
  role: MemberRole;
};

// Identity + the household it belongs to. Still one household per user;
// this is the only place that assumption lives, so multi-household later
// is a query change here, not a rewrite of every caller.
export const getCurrentMembership = cache(async (): Promise<CurrentMembership> => {
  const identity = await getViewerIdentity();
  const membership = await getMembershipForUser(identity.userId);

  if (!membership) {
    if (identity.source === "home-assistant") {
      // A real HA user who hasn't been admitted to the household yet -
      // park them until an owner links them on Settings → Members.
      redirect(`${await getIngressPath()}/welcome`);
    }
    // A valid JWT whose user has no membership means the session outlived
    // its user row — the after-effect of restoring a backup from a
    // different install. Self-heal by clearing the cookie and landing on
    // /login (a plain throw would 500 every page, and proxy.ts's optimistic
    // cookie check keeps /login unreachable while the stale cookie exists).
    redirect(`${await getIngressPath()}/api/auth/reset-session`);
  }

  return {
    ...identity,
    householdId: membership.householdId,
    role: membership.role === "owner" ? "owner" : "member",
  };
});

export const getCurrentHousehold = cache(async () => {
  return (await getCurrentMembership()).householdId;
});

// Owner-only screens and actions (member management). Pages redirect;
// Server Actions get the same check as a thrown error via requireOwner's
// caller choosing which it wants - here we always redirect, since a
// non-owner submitting an owner form is a stale UI, not an attack to 500 on.
export async function requireOwner(): Promise<CurrentMembership> {
  const membership = await getCurrentMembership();
  if (membership.role !== "owner") {
    redirect(`${await getIngressPath()}/more`);
  }
  return membership;
}
