import { IngressLink } from "@/components/layout/ingress";
import {
  ChevronRight,
  DatabaseBackup,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { getCurrentMembership } from "@/server/lib/dal";
import { getViewerProfile } from "@/server/db/queries/members";
import { AppHeader } from "@/components/layout/AppHeader";
import { ThemeToggleRow } from "@/components/layout/ThemeToggle";
import { Card, CardContent } from "@/components/ui/card";

// The hub for everything that doesn't warrant its own tab. Add new sections
// here as they're built.
const SECTIONS = [
  {
    href: "/settings/people",
    title: "People",
    description: "Manage household members for accounts, income, and net worth tracking",
    icon: Users,
  },
  {
    href: "/debt",
    title: "Debt Payoff",
    description: "Snowball or avalanche your way to debt-free",
    icon: TrendingDown,
  },
  {
    href: "/income",
    title: "Income Tracker",
    description: "W2/1099 income by year, with saved forecasts",
    icon: TrendingUp,
  },
  {
    href: "/settings/members",
    title: "Members",
    description: "Who can open this budget from Home Assistant, and which person each one is",
    icon: ShieldCheck,
    ownerOnly: true,
  },
  {
    href: "/settings/simplefin",
    title: "Bank Sync",
    description: "SimpleFin connection and account mapping",
    icon: RefreshCw,
  },
  {
    href: "/more/account",
    title: "Login & Security",
    description: "Password for signing in outside Home Assistant",
    icon: KeyRound,
  },
  {
    href: "/more/backup",
    title: "Backup & Restore",
    description: "Download a full data backup or restore from one",
    icon: DatabaseBackup,
  },
] as const;

export default async function MorePage() {
  const membership = await getCurrentMembership();
  const viewer = await getViewerProfile(membership.householdId, membership.userId);
  const sections = SECTIONS.filter(
    (s) => !("ownerOnly" in s && s.ownerOnly) || membership.role === "owner",
  );
  const viewerLabel = viewer?.personName ?? viewer?.name ?? viewer?.email ?? "";

  return (
    <div>
      <AppHeader title="More">
        <p className="pt-1 text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{viewerLabel}</span>
          {membership.source === "home-assistant" ? " via Home Assistant" : ""}
        </p>
      </AppHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {sections.map(({ href, title, description, icon: Icon }) => (
          <IngressLink key={href} href={href}>
            <Card>
              <CardContent className="flex items-center gap-4">
                <Icon className="size-6 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{title}</div>
                  <div className="truncate text-sm text-muted-foreground">{description}</div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </IngressLink>
        ))}
        <ThemeToggleRow />
      </div>
    </div>
  );
}
