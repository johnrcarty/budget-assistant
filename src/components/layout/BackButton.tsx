"use client";

import { ChevronLeft } from "lucide-react";
import { useIngressNavigate } from "@/components/layout/ingress";

// history.back() (not a navigation to the same href) is what restores the
// previous page's scroll position - it's real browser history back, not a
// fresh navigation into /budget. Falls back to a plain navigation only
// when there's no history to go back to (e.g. the page was opened directly).
export function BackButton({ fallbackHref }: { fallbackHref: string }) {
  const navigate = useIngressNavigate();

  return (
    <button
      type="button"
      aria-label="Back"
      className="-ml-2 p-2"
      onClick={() => {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          navigate(fallbackHref);
        }
      }}
    >
      <ChevronLeft className="size-6" />
    </button>
  );
}
