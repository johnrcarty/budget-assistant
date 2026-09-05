import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { getMembershipForUser } from "@/server/db/queries/members";
import { getViewerIdentity } from "@/server/lib/dal";
import { getIngressPath } from "@/server/lib/ingress";
import { IngressLink } from "@/components/layout/ingress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

// Holding page for a Home Assistant user the app has seen but nobody has
// admitted to the household yet. Deliberately outside the (app) group: no
// tab bar, and getCurrentHousehold() would just bounce back here.
export default async function WelcomePage() {
  const { userId } = await getViewerIdentity();
  if (await getMembershipForUser(userId)) {
    redirect(`${await getIngressPath()}/summary`);
  }
  const [user] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Almost there</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Hi{user?.name ? ` ${user.name}` : ""}. You&apos;re signed in to Home Assistant, but
            you haven&apos;t been added to this household&apos;s budget yet.
          </p>
          <p className="text-sm text-muted-foreground">
            Ask the household owner to add you under <strong>More → Members</strong>, then come
            back here.
          </p>
          <IngressLink href="/welcome" className={buttonVariants()}>
            Check again
          </IngressLink>
        </CardContent>
      </Card>
    </div>
  );
}
