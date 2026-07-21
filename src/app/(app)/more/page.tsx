import Link from "next/link";
import { ChevronRight, RefreshCw, TrendingDown } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card, CardContent } from "@/components/ui/card";

// The hub for everything that doesn't warrant its own tab. Add new sections
// here as they're built.
const SECTIONS = [
  {
    href: "/debt",
    title: "Debt Payoff",
    description: "Snowball or avalanche your way to debt-free",
    icon: TrendingDown,
  },
  {
    href: "/settings/simplefin",
    title: "Bank Sync",
    description: "SimpleFin connection and account mapping",
    icon: RefreshCw,
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
      </div>
    </div>
  );
}
