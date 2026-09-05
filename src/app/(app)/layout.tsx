import { getCurrentMembership } from "@/server/lib/dal";
import { BottomTabBar } from "@/components/layout/BottomTabBar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Membership, not just identity: every route in this group needs a
  // household, and resolving it here (before any page-level Suspense
  // boundary starts streaming) turns "not a member yet" into a clean 307
  // to /welcome instead of a redirect delivered mid-stream.
  await getCurrentMembership();

  // Bottom padding must clear the fixed BottomTabBar: 4rem of bar plus the
  // device's bottom safe-area inset, which the bar also pads itself by -
  // WebKit propagates that inset into the HA ingress iframe, so without it
  // the last row of every page hides behind the bar.
  return (
    <div className="min-h-svh bg-background pb-[calc(4rem+env(safe-area-inset-bottom))]">
      {children}
      <BottomTabBar />
    </div>
  );
}
