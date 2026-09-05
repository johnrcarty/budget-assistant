import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/layout/AppHeader";
import { UpdateLoginForm } from "@/components/more/UpdateLoginForm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { verifySession } from "@/server/lib/dal";

export default async function AccountPage() {
  const { userId } = await verifySession();
  const [user] = await db
    .select({ email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // A login provisioned from Home Assistant carries a placeholder email
  // (see queries/members.ts) - show the field empty so the user types a
  // real one rather than "fixing" the placeholder.
  const email = user?.email ?? "";
  const currentEmail = email.endsWith("@home-assistant.invalid") ? "" : email;

  return (
    <div>
      <AppHeader title="Login & Security" backHref="/more" />
      <div className="flex flex-col gap-4 p-4">
        <UpdateLoginForm currentEmail={currentEmail} hasPassword={Boolean(user?.passwordHash)} />
      </div>
    </div>
  );
}
