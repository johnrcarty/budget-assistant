"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

function subscribeNoop() {
  return () => {};
}

// resolvedTheme is undefined until after mount (it depends on the
// localStorage/system value only known client-side). useSyncExternalStore is
// React's own primitive for "this differs between server and client render"
// - server snapshot is false, client snapshot is true - rather than the
// common but effect-based setState-on-mount pattern.
function useMounted() {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

// Appearance row on the More page (used to be a floating button on every
// screen). Tapping anywhere on the card flips light/dark.
export function ThemeToggleRow() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="block w-full text-left"
    >
      <Card>
        <CardContent className="flex items-center gap-4">
          {isDark ? (
            <Sun className="size-6 shrink-0 text-primary" />
          ) : (
            <Moon className="size-6 shrink-0 text-primary" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-medium">Appearance</div>
            <div className="truncate text-sm text-muted-foreground">
              {mounted
                ? isDark
                  ? "Dark mode — tap for light"
                  : "Light mode — tap for dark"
                : "Light or dark mode"}
            </div>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}
