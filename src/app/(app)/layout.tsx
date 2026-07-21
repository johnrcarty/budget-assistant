import { verifySession } from "@/server/lib/dal";
import { BottomTabBar } from "@/components/layout/BottomTabBar";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await verifySession();

  return (
    <div className="min-h-svh bg-muted pb-16">
      {children}
      <ThemeToggle />
      <BottomTabBar />
    </div>
  );
}
