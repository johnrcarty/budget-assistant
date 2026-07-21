import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal, self-contained production image for Docker self-hosting.
  output: "standalone",
};

export default nextConfig;
