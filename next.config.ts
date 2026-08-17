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
    // Next's development runtime uses eval-backed source maps and a WebSocket
    // connection for HMR. Keep those capabilities out of the production CSP,
    // while allowing browser E2E and local development to hydrate normally.
    const developmentCsp = process.env.NODE_ENV === "development";
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' 'unsafe-inline'${developmentCsp ? " 'unsafe-eval'" : ""}`,
      `connect-src 'self'${developmentCsp ? " ws: wss:" : ""}`,
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
