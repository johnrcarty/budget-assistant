"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

// router.back() (not a Link/push to the same href) is what lets Next.js
// restore the list's scroll position - it's real browser history back, not
// a fresh navigation into /budget. Falls back to a plain navigation only
// when there's no history to go back to (e.g. the page was opened directly).
export function BackButton({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      aria-label="Back"
      className="-ml-2 p-2"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
    >
      <ChevronLeft className="size-6" />
    </button>
  );
}
