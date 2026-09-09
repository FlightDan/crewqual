import type { NextConfig } from "next";
import { resolveServiceMode } from "./src/lib/service-mode";

const defaultDistDir = process.env.NODE_ENV === "development" ? ".next-dev" : ".next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  env: {
    // Keep client-side mode selection aligned with the server-side setting.
    NEXT_PUBLIC_SERVICE_MODE: resolveServiceMode(),
  },
  // Keep `next dev` isolated from production builds. Running both against the
  // same directory can leave middleware manifests pointing at deleted chunks.
  distDir: process.env.CREWQUAL_DIST_DIR ?? defaultDistDir,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin" }],
      },
    ];
  },
};

export default nextConfig;
