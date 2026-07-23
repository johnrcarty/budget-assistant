"use server";

import bcrypt from "bcryptjs";
import { eq, ne, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { verifySession } from "@/server/lib/dal";

const updateSchema = z
  .object({
    // Normalize before validating - trailing whitespace from mobile
    // keyboards shouldn't fail the format check. Lowercased to match the
    // login lookup and seed script.
    email: z.string().trim().toLowerCase().max(255).pipe(z.email()),
    currentPassword: z.string().min(1, "Current password is required"),
    // Blank = keep the existing password. When set, mirror the seed
    // script's rules (bcrypt cost 12) with a modest length floor.
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters")
      .max(200)
      .or(z.literal(""))
      .optional(),
    confirmPassword: z.string().optional(),
  })
  .refine((v) => !v.newPassword || v.newPassword === v.confirmPassword, {
    message: "New passwords don't match",
    path: ["confirmPassword"],
  });

// Change the shared household login's email and/or password. Requires the
// current password - the session cookie alone isn't enough to rotate
// credentials (a borrowed unlocked phone shouldn't be able to lock the
// household out).
//
// Existing JWT sessions stay valid after a change (they're signed, not
// checked against the DB), so the other phone keeps working until its next
// sign-in, which needs the new credentials.
export async function updateLoginCredentials(formData: FormData) {
  const { userId } = await verifySession();

  const input = updateSchema.parse({
    email: formData.get("email"),
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword") ?? undefined,
    confirmPassword: formData.get("confirmPassword") ?? undefined,
  });

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.passwordHash) {
    throw new Error("This login can't be managed here.");
  }

  const passwordOk = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!passwordOk) {
    throw new Error("Current password is incorrect.");
  }

  const normalizedEmail = input.email;

  if (normalizedEmail !== user.email) {
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, normalizedEmail), ne(users.id, userId)))
      .limit(1);
    if (taken) {
      throw new Error("That email is already in use.");
    }
  }

  const newPasswordHash = input.newPassword
    ? await bcrypt.hash(input.newPassword, 12)
    : user.passwordHash;

  await db
    .update(users)
    .set({ email: normalizedEmail, passwordHash: newPasswordHash })
    .where(eq(users.id, userId));
}
