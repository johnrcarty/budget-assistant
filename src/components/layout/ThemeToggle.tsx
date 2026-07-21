"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

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

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  return (
    <button
      type="button"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="fixed right-4 bottom-20 z-40 flex size-11 items-center justify-center rounded-full bg-card text-foreground shadow-md ring-1 ring-foreground/10"
    >
      {mounted && resolvedTheme === "dark" ? (
        <Sun className="size-5" />
      ) : (
        <Moon className="size-5" />
      )}
    </button>
  );
}
