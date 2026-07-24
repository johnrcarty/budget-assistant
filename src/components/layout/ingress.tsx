"use client";

import { createContext, useContext } from "react";

// Home Assistant ingress serves the app under a dynamic, per-install
// `/api/hassio_ingress/<token>` prefix that only exists at request time -
// Next's client-side router builds navigation URLs from a build-time
// basePath and can never learn it, which is why in-app navigation 404'd
// under real ingress (epic #70). The fix: no client-side routing at all.
// Every navigation is a plain <a> whose href is prefixed with the ingress
// path the server saw on the current request (threaded down from the root
// layout via this context). On the plain LAN/Docker Compose deployment the
// prefix is "" and these render the same URLs as before.
const IngressPathContext = createContext("");

export function IngressPathProvider({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  return <IngressPathContext.Provider value={value}>{children}</IngressPathContext.Provider>;
}

export function useIngressPath(): string {
  return useContext(IngressPathContext);
}

// usePathname() returns the browser's real path, which under ingress
// includes the prefix - strip it before comparing against app routes.
export function stripIngressPath(pathname: string, prefix: string): string {
  return prefix && pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
}

// Programmatic counterpart to IngressLink for event handlers that used
// router.push: a full-page navigation to the ingress-prefixed URL.
export function useIngressNavigate(): (href: string) => void {
  const prefix = useIngressPath();
  return (href: string) => window.location.assign(`${prefix}${href}`);
}

type IngressLinkProps = Omit<React.ComponentProps<"a">, "href"> & { href: string };

// Drop-in replacement for next/link that opts out of client-side routing:
// a full-page navigation to the ingress-prefixed URL. `href` must be a
// root-relative app path ("/budget?month=...").
export function IngressLink({ href, ...props }: IngressLinkProps) {
  const prefix = useIngressPath();
  return <a href={`${prefix}${href}`} {...props} />;
}
