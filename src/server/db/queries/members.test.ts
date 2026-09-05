import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  HA_PROVIDER,
  createPersonForMember,
  getMembershipForUser,
  getViewerProfile,
  listMembers,
  removeMember,
  resolveHaUser,
  setMemberPerson,
  setMemberRole,
} from "@/server/db/queries/members";
import { householdMembers, oauthAccounts, persons, users } from "@/server/db/schema";
import { getTestDb, type TestDb } from "../../../../tests/helpers/pglite";
import { seedHousehold } from "../../../../tests/helpers/seed";

vi.mock("@/server/db/client", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/pglite");
  return { db: await createTestDb() };
});

let db: TestDb;
beforeAll(() => {
  db = getTestDb();
});

// The whole module reasons about "every user in this install" (single
// household), so each test wipes the global auth tables for isolation.
async function resetUsers() {
  await db.delete(users);
}

async function seedBootstrapLogin(householdId: string) {
  const [user] = await db
    .insert(users)
    .values({ email: "household@example.com", passwordHash: "x", name: "Household" })
    .returning();
  await db.insert(householdMembers).values({ householdId, userId: user.id, role: "owner" });
  return user;
}

const ha = (id: string, displayName: string | null = null) => ({
  id,
  username: displayName?.toLowerCase() ?? null,
  displayName,
});

describe("resolveHaUser", () => {
  it("auto-links the first HA user to the lone bootstrap login as the owner", async () => {
    await resetUsers();
    const household = await seedHousehold(db);
    const bootstrap = await seedBootstrapLogin(household.id);

    const result = await resolveHaUser(ha("ha-1", "John"));

    expect(result).toEqual({ userId: bootstrap.id, outcome: "bootstrap" });
    const [link] = await db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.providerAccountId, "ha-1"));
    expect(link.provider).toBe(HA_PROVIDER);
    expect(link.userId).toBe(bootstrap.id);
    expect(await getMembershipForUser(bootstrap.id)).toMatchObject({ role: "owner" });
  });

  it("creates a pending (membership-less) user for every later HA user", async () => {
    await resetUsers();
    const household = await seedHousehold(db);
    await seedBootstrapLogin(household.id);
    await resolveHaUser(ha("ha-1", "John"));

    const second = await resolveHaUser(ha("ha-2", "Natasha"));

    expect(second.outcome).toBe("created");
    const [user] = await db.select().from(users).where(eq(users.id, second.userId));
    expect(user.name).toBe("Natasha");
    expect(user.email).toBe("ha-ha-2@home-assistant.invalid");
    expect(user.passwordHash).toBeNull();
    expect(await getMembershipForUser(second.userId)).toBeNull();
  });

  it("does not auto-link when the household already has more than one member", async () => {
    await resetUsers();
    const household = await seedHousehold(db);
    await seedBootstrapLogin(household.id);
    const [other] = await db
      .insert(users)
      .values({ email: "other@example.com", passwordHash: "x" })
      .returning();
    await db.insert(householdMembers).values({ householdId: household.id, userId: other.id });

    const result = await resolveHaUser(ha("ha-1", "John"));
    expect(result.outcome).toBe("created");
  });

  it("is idempotent and refreshes the display name on later visits", async () => {
    await resetUsers();
    const household = await seedHousehold(db);
    await seedBootstrapLogin(household.id);
    await resolveHaUser(ha("ha-1"));
    const created = await resolveHaUser(ha("ha-2", "Natasha"));

    const again = await resolveHaUser(ha("ha-2", "Tasha"));

    expect(again).toEqual({ userId: created.userId, outcome: "linked" });
    const [user] = await db.select().from(users).where(eq(users.id, created.userId));
    expect(user.name).toBe("Tasha");
    expect((await db.select().from(users)).length).toBe(2);
  });

  it("survives concurrent first requests for the same new HA user", async () => {
    await resetUsers();
    const household = await seedHousehold(db);
    await seedBootstrapLogin(household.id);
    await resolveHaUser(ha("ha-1"));

    const results = await Promise.all([
      resolveHaUser(ha("ha-9", "Kid")),
      resolveHaUser(ha("ha-9", "Kid")),
      resolveHaUser(ha("ha-9", "Kid")),
    ]);

    const ids = new Set(results.map((r) => r.userId));
    expect(ids.size).toBe(1);
    const rows = await db.select().from(users).where(eq(users.name, "Kid"));
    expect(rows.length).toBe(1);
  });
});

describe("membership management", () => {
  async function setup() {
    await resetUsers();
    const household = await seedHousehold(db);
    const owner = await seedBootstrapLogin(household.id);
    await resolveHaUser(ha("ha-1", "John"));
    const pending = await resolveHaUser(ha("ha-2", "Natasha"));
    const [person] = await db
      .insert(persons)
      .values({ householdId: household.id, name: "Natasha" })
      .returning();
    return { household, owner, pendingUserId: pending.userId, person };
  }

  it("listMembers shows pending users with a null role and linked persons", async () => {
    const { household, owner, pendingUserId, person } = await setup();
    await setMemberPerson(household.id, pendingUserId, person.id);

    const rows = await listMembers(household.id);
    expect(rows.map((r) => [r.userId, r.role, r.personId, r.haUserId, r.hasPassword])).toEqual([
      [owner.id, "owner", null, "ha-1", true],
      [pendingUserId, "member", person.id, "ha-2", false],
    ]);
  });

  it("setMemberPerson admits the user and moves the link between persons", async () => {
    const { household, pendingUserId, person } = await setup();
    const [second] = await db
      .insert(persons)
      .values({ householdId: household.id, name: "Second" })
      .returning();

    await setMemberPerson(household.id, pendingUserId, person.id);
    await setMemberPerson(household.id, pendingUserId, second.id);

    const linked = await db.select().from(persons).where(eq(persons.userId, pendingUserId));
    expect(linked.map((p) => p.id)).toEqual([second.id]);
    expect(await getMembershipForUser(pendingUserId)).toMatchObject({ role: "member" });

    await setMemberPerson(household.id, pendingUserId, null);
    expect(await db.select().from(persons).where(eq(persons.userId, pendingUserId))).toEqual([]);
  });

  it("rejects linking a person from another household", async () => {
    const { household, pendingUserId } = await setup();
    const foreign = await seedHousehold(db, "Other");
    const [foreignPerson] = await db
      .insert(persons)
      .values({ householdId: foreign.id, name: "Stranger" })
      .returning();

    await expect(
      setMemberPerson(household.id, pendingUserId, foreignPerson.id),
    ).rejects.toThrow(/doesn't belong/);
    expect(await getMembershipForUser(pendingUserId)).toBeNull();
  });

  it("createPersonForMember creates a linked person and admits the user", async () => {
    const { household, pendingUserId } = await setup();
    const personId = await createPersonForMember(household.id, pendingUserId, {
      name: "Kiddo",
      personType: "child",
    });
    const profile = await getViewerProfile(household.id, pendingUserId);
    expect(profile).toMatchObject({ personId, personName: "Kiddo", personType: "child" });
    expect(await getMembershipForUser(pendingUserId)).toMatchObject({ role: "member" });
  });

  it("never lets the last owner be demoted or removed", async () => {
    const { household, owner, pendingUserId } = await setup();
    await expect(setMemberRole(household.id, owner.id, "member")).rejects.toThrow(/owner/);
    await expect(removeMember(household.id, owner.id)).rejects.toThrow(/owner/);

    await setMemberPerson(household.id, pendingUserId, null, "owner");
    await setMemberRole(household.id, owner.id, "member");
    expect(await getMembershipForUser(owner.id)).toMatchObject({ role: "member" });
  });

  it("removeMember drops access and the person link but keeps the login", async () => {
    const { household, pendingUserId, person } = await setup();
    await setMemberPerson(household.id, pendingUserId, person.id);

    await removeMember(household.id, pendingUserId);

    expect(await getMembershipForUser(pendingUserId)).toBeNull();
    const [p] = await db.select().from(persons).where(eq(persons.id, person.id));
    expect(p.userId).toBeNull();
    expect((await resolveHaUser(ha("ha-2", "Natasha"))).userId).toBe(pendingUserId);
  });
});
