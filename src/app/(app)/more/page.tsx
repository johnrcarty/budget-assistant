import Link from "next/link";
import {
  ChevronRight,
  DatabaseBackup,
  KeyRound,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
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
    href: "/settings/simplefin",
    title: "Bank Sync",
    description: "SimpleFin connection and account mapping",
    icon: RefreshCw,
  },
  {
    href: "/more/account",
    title: "Login & Security",
    description: "Change the household login email and password",
    icon: KeyRound,
  },
  {
    href: "/more/backup",
    title: "Backup & Restore",
    description: "Download a full data backup or restore from one",
    icon: DatabaseBackup,
  },
] as const;

export default function MorePage() {
  return (
    <div>
      <AppHeader title="More" />
      <div className="flex flex-col gap-3 px-4 pb-4">
        {SECTIONS.map(({ href, title, description, icon: Icon }) => (
          <Link key={href} href={href}>
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
          </Link>
        ))}
        <ThemeToggleRow />
      </div>
    </div>
  );
}
