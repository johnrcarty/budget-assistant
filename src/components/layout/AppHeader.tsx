import type { ReactNode } from "react";
import { BackButton } from "./BackButton";

export function AppHeader({
  title,
  backHref,
  rightAction,
  children,
}: {
  title: string;
  backHref?: string;
  rightAction?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="px-4 pt-6 pb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {backHref && <BackButton fallbackHref={backHref} />}
          <h1 className="text-2xl font-bold">{title}</h1>
        </div>
        {rightAction}
      </div>
      {children}
    </header>
  );
}
