import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal, self-contained production image for Docker self-hosting.
  output: "standalone",
  async redirects() {
    return [
      // The Today tab became Summary; keep old bookmarks/PWA icons working.
      { source: "/today", destination: "/summary", permanent: true },
    ];
  },
};

export default nextConfig;
