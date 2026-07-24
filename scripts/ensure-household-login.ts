// Creates the initial household/user/membership rows from
// HOUSEHOLD_LOGIN_EMAIL/HOUSEHOLD_LOGIN_PASSWORD if (and only if) no user
// with that email exists yet. Idempotent and safe to run on every boot:
// never touches an existing user's password (that would clobber a password
// changed later via the in-app Login & Security screen), and no-ops
// entirely if the env vars aren't set.
//
//   npx tsx --env-file=.env.local scripts/ensure-household-login.ts
//
// This is the generic bootstrap step the HA add-on runs automatically
// (see ha-addon/rootfs/etc/s6-overlay/scripts/run-migrate.sh) in place of
// manually running the gitignored, real-data-bearing scripts/seed.ts that
// the plain Docker Compose deployment is seeded with today.
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users, households, householdMembers } from "@/server/db/schema";

async function main() {
  const email = process.env.HOUSEHOLD_LOGIN_EMAIL?.trim().toLowerCase();
  const password = process.env.HOUSEHOLD_LOGIN_PASSWORD;

  if (!email || !password) {
    console.log(
      "[ensure-household-login] HOUSEHOLD_LOGIN_EMAIL/HOUSEHOLD_LOGIN_PASSWORD not set, skipping",
    );
    return;
  }

  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    console.log(
      `[ensure-household-login] user ${email} already exists, leaving password untouched`,
    );
  } else {
    const passwordHash = await bcrypt.hash(password, 12);
    const [created] = await db
      .insert(users)
      .values({ email, passwordHash })
      .returning({ id: users.id });
    userId = created.id;
    console.log(`[ensure-household-login] created user ${email}`);
  }

  const [membership] = await db
    .select()
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .limit(1);

  if (membership) {
    console.log("[ensure-household-login] household membership already exists");
    return;
  }

  const [household] = await db
    .insert(households)
    .values({ name: "Household" })
    .returning({ id: households.id });
  await db
    .insert(householdMembers)
    .values({ householdId: household.id, userId, role: "owner" });
  console.log(`[ensure-household-login] created household + membership for ${email}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
