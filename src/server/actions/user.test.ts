import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { updateLoginCredentials } from "@/server/actions/user";
import { users } from "@/server/db/schema";
import { verifySession } from "@/server/lib/dal";
import { getTestDb, type TestDb } from "../../../tests/helpers/pglite";

vi.mock("@/server/db/client", async () => {
  const { createTestDb } = await import("../../../tests/helpers/pglite");
  return { db: await createTestDb() };
});

vi.mock("@/server/lib/dal", () => ({
  verifySession: vi.fn(),
}));

const mockSession = vi.mocked(verifySession);

let db: TestDb;
beforeAll(() => {
  db = getTestDb();
});

// Low cost factor to keep the suite fast - the action itself always
// hashes new passwords at cost 12.
async function seedLoginUser(email: string, password: string) {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: await bcrypt.hash(password, 4), name: "Household" })
    .returning();
  mockSession.mockResolvedValue({ userId: user.id });
  return user;
}

function form(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

const getUser = async (id: string) => {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
};

describe("updateLoginCredentials", () => {
  it("changes email and password with the correct current password", async () => {
    const user = await seedLoginUser("old@example.com", "old-password");

    await updateLoginCredentials(
      form({
        email: "New@Example.com ",
        currentPassword: "old-password",
        newPassword: "brand-new-pass",
        confirmPassword: "brand-new-pass",
      }),
    );

    const updated = await getUser(user.id);
    // Normalized exactly like the login lookup expects.
    expect(updated.email).toBe("new@example.com");
    expect(await bcrypt.compare("brand-new-pass", updated.passwordHash!)).toBe(true);
    expect(await bcrypt.compare("old-password", updated.passwordHash!)).toBe(false);
  });

  it("keeps the existing password when the new-password fields are blank", async () => {
    const user = await seedLoginUser("keep@example.com", "same-password");

    await updateLoginCredentials(
      form({
        email: "kept@example.com",
        currentPassword: "same-password",
        newPassword: "",
        confirmPassword: "",
      }),
    );

    const updated = await getUser(user.id);
    expect(updated.email).toBe("kept@example.com");
    expect(await bcrypt.compare("same-password", updated.passwordHash!)).toBe(true);
  });

  it("rejects a wrong current password without changing anything", async () => {
    const user = await seedLoginUser("victim@example.com", "right-password");

    await expect(
      updateLoginCredentials(
        form({
          email: "attacker@example.com",
          currentPassword: "wrong-password",
          newPassword: "hijacked-pass",
          confirmPassword: "hijacked-pass",
        }),
      ),
    ).rejects.toThrow("Current password is incorrect");

    const unchanged = await getUser(user.id);
    expect(unchanged.email).toBe("victim@example.com");
    expect(await bcrypt.compare("right-password", unchanged.passwordHash!)).toBe(true);
  });

  it("rejects mismatched new passwords", async () => {
    await seedLoginUser("mismatch@example.com", "current-pass");

    await expect(
      updateLoginCredentials(
        form({
          email: "mismatch@example.com",
          currentPassword: "current-pass",
          newPassword: "one-password",
          confirmPassword: "other-password",
        }),
      ),
    ).rejects.toThrow(/don't match/);
  });

  it("rejects a too-short new password", async () => {
    await seedLoginUser("short@example.com", "current-pass");

    await expect(
      updateLoginCredentials(
        form({
          email: "short@example.com",
          currentPassword: "current-pass",
          newPassword: "short",
          confirmPassword: "short",
        }),
      ),
    ).rejects.toThrow(/at least 8/);
  });

  it("rejects an email already used by another user", async () => {
    await seedLoginUser("taken@example.com", "whatever-pass");
    const user = await seedLoginUser("mine@example.com", "current-pass");

    await expect(
      updateLoginCredentials(
        form({
          email: "taken@example.com",
          currentPassword: "current-pass",
        }),
      ),
    ).rejects.toThrow("already in use");

    expect((await getUser(user.id)).email).toBe("mine@example.com");
  });
});
