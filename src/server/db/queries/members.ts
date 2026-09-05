import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { householdMembers, oauthAccounts, persons, users } from "@/server/db/schema";
import type { HaUser } from "@/server/lib/ha-identity";

// A Home Assistant identity is stored as an Auth.js-shaped "linked login"
// row in oauth_account: provider = HA_PROVIDER, providerAccountId = the HA
// user id. No new auth tables - this is exactly the row an OIDC provider
// would have written, minus the tokens (Supervisor never gives us any).
export const HA_PROVIDER = "home-assistant";

export const MEMBER_ROLES = ["owner", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

// Placeholder email for a user provisioned from HA. `user.email` is NOT
// NULL + unique and the HA user id is unique, so this can't collide; the
// .invalid TLD (RFC 2606) makes it obviously not deliverable. The user can
// replace it on Login & Security when setting a password for the JWT
// fallback login.
function placeholderEmail(haUserId: string): string {
  return `ha-${haUserId}@home-assistant.invalid`;
}

function displayNameFor(haUser: HaUser): string {
  return haUser.displayName ?? haUser.username ?? "Home Assistant user";
}

async function findLinkedUserId(haUserId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(
      and(eq(oauthAccounts.provider, HA_PROVIDER), eq(oauthAccounts.providerAccountId, haUserId)),
    )
    .limit(1);
  return row?.userId ?? null;
}

// The first HA user this install ever sees, while the household still has
// exactly its one bootstrap login and nothing linked yet, IS the person who
// installed the add-on: link them to that login (the owner) instead of
// creating a pending user. Zero-config upgrade for the existing install.
// Returns null when the condition doesn't hold.
async function bootstrapOwnerUserId(): Promise<string | null> {
  const [{ linked }] = await db
    .select({ linked: sql<number>`count(*)::int` })
    .from(oauthAccounts)
    .where(eq(oauthAccounts.provider, HA_PROVIDER));
  if (linked > 0) return null;

  const members = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .limit(2);
  if (members.length !== 1) return null;
  return members[0].userId;
}

export type ResolvedHaUser = {
  userId: string;
  // "linked": seen before · "bootstrap": auto-linked to the original login ·
  // "created": brand-new user with no household membership (pending).
  outcome: "linked" | "bootstrap" | "created";
};

// Maps the HA user on a trusted ingress request to a `user` row, creating
// one when needed. Idempotent and safe under concurrent first requests
// (the oauth_account primary key arbitrates; the loser re-reads).
export async function resolveHaUser(haUser: HaUser): Promise<ResolvedHaUser> {
  const existing = await findLinkedUserId(haUser.id);
  if (existing) {
    if (haUser.displayName) {
      await db
        .update(users)
        .set({ name: haUser.displayName })
        .where(and(eq(users.id, existing), ne(users.name, haUser.displayName)));
    }
    return { userId: existing, outcome: "linked" };
  }

  const bootstrapUserId = await bootstrapOwnerUserId();
  if (bootstrapUserId) {
    const [inserted] = await db
      .insert(oauthAccounts)
      .values({
        userId: bootstrapUserId,
        type: "oauth",
        provider: HA_PROVIDER,
        providerAccountId: haUser.id,
      })
      .onConflictDoNothing()
      .returning({ userId: oauthAccounts.userId });
    if (inserted) return { userId: bootstrapUserId, outcome: "bootstrap" };
    // Lost a race with a parallel request for the same HA user.
    return { userId: (await findLinkedUserId(haUser.id))!, outcome: "linked" };
  }

  const createdUserId = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email: placeholderEmail(haUser.id), name: displayNameFor(haUser) })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (!user) return null;
    const [link] = await tx
      .insert(oauthAccounts)
      .values({
        userId: user.id,
        type: "oauth",
        provider: HA_PROVIDER,
        providerAccountId: haUser.id,
      })
      .onConflictDoNothing()
      .returning({ userId: oauthAccounts.userId });
    if (!link) {
      tx.rollback();
    }
    return user.id;
  }).catch(() => null);

  if (createdUserId) return { userId: createdUserId, outcome: "created" };
  const raced = await findLinkedUserId(haUser.id);
  if (!raced) throw new Error("Could not provision a user for the Home Assistant identity.");
  return { userId: raced, outcome: "linked" };
}

export async function getMembershipForUser(userId: string) {
  const [membership] = await db
    .select({ householdId: householdMembers.householdId, role: householdMembers.role })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .limit(1);
  return membership ?? null;
}

export interface MemberListRow {
  userId: string;
  name: string | null;
  email: string;
  hasPassword: boolean;
  haUserId: string | null;
  // null = seen (has a login) but not yet a member of this household.
  role: string | null;
  personId: string | null;
  personName: string | null;
  personType: string | null;
  createdAt: Date;
}

// Every login this install knows about, whether or not it's been admitted
// to the household yet - the Members page is where pending HA users get
// linked to a person. Single-household app, so "every user" is the right
// universe.
export async function listMembers(householdId: string): Promise<MemberListRow[]> {
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      hasPassword: sql<boolean>`(${users.passwordHash} is not null)`,
      haUserId: oauthAccounts.providerAccountId,
      role: householdMembers.role,
      personId: persons.id,
      personName: persons.name,
      personType: persons.personType,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(
      oauthAccounts,
      and(eq(oauthAccounts.userId, users.id), eq(oauthAccounts.provider, HA_PROVIDER)),
    )
    .leftJoin(
      householdMembers,
      and(eq(householdMembers.userId, users.id), eq(householdMembers.householdId, householdId)),
    )
    .leftJoin(persons, and(eq(persons.userId, users.id), eq(persons.householdId, householdId)))
    .orderBy(asc(users.createdAt));
}

async function countOwners(householdId: string, exceptUserId?: string): Promise<number> {
  const [{ owners }] = await db
    .select({ owners: sql<number>`count(*)::int` })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.role, "owner"),
        exceptUserId ? ne(householdMembers.userId, exceptUserId) : undefined,
      ),
    );
  return owners;
}

// Admits a user to the household (no-op if already a member) and links them
// to a person (or clears the link with null). A user is linked to at most
// one person per household and a person to at most one user, so any other
// person currently pointing at this user is unlinked first.
export async function setMemberPerson(
  householdId: string,
  userId: string,
  personId: string | null,
  role: MemberRole = "member",
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(householdMembers)
      .values({ householdId, userId, role })
      .onConflictDoNothing();

    await tx
      .update(persons)
      .set({ userId: null })
      .where(and(eq(persons.householdId, householdId), eq(persons.userId, userId)));

    if (personId) {
      const [updated] = await tx
        .update(persons)
        .set({ userId })
        .where(and(eq(persons.id, personId), eq(persons.householdId, householdId)))
        .returning({ id: persons.id });
      if (!updated) throw new Error("That person doesn't belong to this household.");
    }
  });
}

// Creates a new person already linked to the user and admits them.
export async function createPersonForMember(
  householdId: string,
  userId: string,
  input: { name: string; personType: "adult" | "child" },
  role: MemberRole = "member",
): Promise<string> {
  return db.transaction(async (tx) => {
    await tx
      .insert(householdMembers)
      .values({ householdId, userId, role })
      .onConflictDoNothing();
    await tx
      .update(persons)
      .set({ userId: null })
      .where(and(eq(persons.householdId, householdId), eq(persons.userId, userId)));
    const [person] = await tx
      .insert(persons)
      .values({ householdId, userId, name: input.name, personType: input.personType })
      .returning({ id: persons.id });
    return person.id;
  });
}

export async function setMemberRole(
  householdId: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  if (role !== "owner" && (await countOwners(householdId, userId)) === 0) {
    throw new Error("The household needs at least one owner.");
  }
  const [updated] = await db
    .update(householdMembers)
    .set({ role })
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
    .returning({ userId: householdMembers.userId });
  if (!updated) throw new Error("That user isn't a member of this household.");
}

// Revokes access. The user row and its HA link stay, so the person shows up
// again as "pending" on their next visit rather than being silently
// re-provisioned as a stranger. Their person keeps its financial history,
// just without a login attached.
export async function removeMember(householdId: string, userId: string): Promise<void> {
  if ((await countOwners(householdId, userId)) === 0) {
    throw new Error("The household needs at least one owner.");
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(householdMembers)
      .where(
        and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)),
      );
    await tx
      .update(persons)
      .set({ userId: null })
      .where(and(eq(persons.householdId, householdId), eq(persons.userId, userId)));
  });
}

// Who's looking: the viewer's login plus their person in this household,
// if linked. Later visibility rules key off personId; a null personId is
// an owner who hasn't set people up yet and sees everything.
export async function getViewerProfile(householdId: string, userId: string) {
  const [row] = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      hasPassword: sql<boolean>`(${users.passwordHash} is not null)`,
      haUserId: oauthAccounts.providerAccountId,
      personId: persons.id,
      personName: persons.name,
      personType: persons.personType,
    })
    .from(users)
    .leftJoin(
      oauthAccounts,
      and(eq(oauthAccounts.userId, users.id), eq(oauthAccounts.provider, HA_PROVIDER)),
    )
    .leftJoin(persons, and(eq(persons.userId, users.id), eq(persons.householdId, householdId)))
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}
