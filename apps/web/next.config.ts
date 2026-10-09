import type { NextConfig } from "next";

const API_URL = process.env.API_URL || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  async rewrites() {
    // Same-origin /api in production, FastAPI in dev.
    // Priority: explicit NEXT_PUBLIC_API_URL handled client-side;
    // this rewrite covers relative /api calls when served together.
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
    ];
  },
};

export default nextConfig;
