import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { IngressPathProvider } from "@/components/layout/ingress";
import { getIngressPath } from "@/server/lib/ingress";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Budget Assistant",
  description: "A self-hosted zero-based budget and finance tracker.",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#3a9451",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Reading the ingress header makes every route dynamically rendered,
  // which this app effectively is already (auth cookie on every page).
  const ingressPath = await getIngressPath();
  return (
    <html
      lang="en"
      // next-themes sets the dark/light class on this element client-side
      // after checking localStorage/system preference, which legitimately
      // differs from the server-rendered markup - this suppresses the
      // resulting (expected, harmless) hydration warning on just this tag.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <IngressPathProvider value={ingressPath}>{children}</IngressPathProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
