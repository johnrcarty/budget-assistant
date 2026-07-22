"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Wallet, ArrowLeftRight, Landmark, Ellipsis } from "lucide-react";
import { cn } from "@/lib/utils";

// `matches` lists extra path prefixes that light this tab up - the More tab
// owns the hub's child pages, which don't live under /more.
const TABS = [
  { href: "/summary", label: "Summary", icon: LayoutDashboard },
  { href: "/budget", label: "Budget", icon: Wallet },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/more", label: "More", icon: Ellipsis, matches: ["/debt", "/income", "/settings"] },
] as const;

export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t bg-card pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-lg items-stretch justify-between">
        {TABS.map(({ href, label, icon: Icon, ...tab }) => {
          const matches = "matches" in tab ? tab.matches : [];
          const isActive = [href, ...matches].some((prefix) => pathname.startsWith(prefix));
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center gap-1 py-2 text-xs",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" strokeWidth={isActive ? 2.5 : 2} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
