import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/server/lib/auth";
import { db } from "@/server/db/client";
import { householdMembers } from "@/server/db/schema";

export const verifySession = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return { userId: session.user.id };
});

// v1 has exactly one household per user (single shared login). This is the
// only place that assumption lives, so switching to multi-household
// membership later is a query change here, not a rewrite of every caller.
export const getCurrentHousehold = cache(async () => {
  const { userId } = await verifySession();

  const [membership] = await db
    .select({ householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .limit(1);

  if (!membership) {
    throw new Error(`User ${userId} has no household membership`);
  }

  return membership.householdId;
});
