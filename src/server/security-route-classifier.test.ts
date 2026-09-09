import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifySecurityRoute,
  findPublicPageRoute,
  isKnownProbePath,
  PUBLIC_PAGE_ROUTES,
} from "@/server/security-route-classifier";

function pageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "api") return pageFiles(absolute);
    return entry.name === "page.tsx" ? [absolute] : [];
  });
}

describe("security ingress route classifier", () => {
  it("keeps every app-router page in the explicit classifier inventory", () => {
    const appRoot = path.resolve(process.cwd(), "src/app");
    const pages = pageFiles(appRoot)
      .map((file) => {
        const relative = path.relative(appRoot, path.dirname(file)).replaceAll(path.sep, "/");
        return relative ? `/${relative}` : "/";
      })
      .sort();
    expect([...PUBLIC_PAGE_ROUTES].sort()).toEqual(pages);
  });

  it.each([
    ["/admin/members/4fbb2d43", "/admin/members/[memberId]"],
    ["/member/access/secret-looking-value", "/member/access/[token]"],
    ["/", "/"],
  ])("matches page template %s", (pathname, expected) => {
    expect(findPublicPageRoute(pathname)).toBe(expected);
  });

  it.each([
    "/.env",
    "/foo/.git/config",
    "/wp-admin",
    "/wp-login.php",
    "/cgi-bin/status",
    "/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php",
    "/safe/%252e%252e/etc/passwd",
    "/api/internal/network-access",
  ])("recognizes known probe %s", (pathname) => {
    expect(isKnownProbePath(pathname)).toBe(true);
    expect(classifySecurityRoute(pathname, "GET").terminalKind).toBe("KNOWN_PROBE");
  });

  it("classifies known, unknown and invalid-method routes without query data", () => {
    expect(classifySecurityRoute("/api/admin/members/a", "GET")).toMatchObject({
      terminalKind: null,
      outcome: "KNOWN_ROUTE",
    });
    expect(classifySecurityRoute("/api/random", "GET")).toEqual({
      routeClass: "UNKNOWN_API",
      terminalKind: "UNKNOWN_ROUTE",
      outcome: "UNKNOWN_API",
    });
    expect(classifySecurityRoute("/admin/dashboard", "TRACE")).toEqual({
      routeClass: "PAGE_ADMIN",
      terminalKind: "INVALID_METHOD",
      outcome: "INVALID_METHOD",
    });
    expect(classifySecurityRoute("/does-not-exist", "GET").routeClass).toBe("UNKNOWN_PAGE");
  });

  it("allows only real framework assets instead of trusting every /_next path", () => {
    expect(
      classifySecurityRoute("/_next/static/chunks/app.js", "GET", {
        staticAssetExists: () => true,
      }),
    ).toEqual({ routeClass: "STATIC_ASSET", terminalKind: null, outcome: "KNOWN_ROUTE" });
    expect(
      classifySecurityRoute("/_next/static/chunks/random-missing.js", "GET", {
        staticAssetExists: () => false,
      }),
    ).toEqual({
      routeClass: "UNKNOWN_STATIC",
      terminalKind: "UNKNOWN_ROUTE",
      outcome: "UNKNOWN_STATIC",
    });
    expect(classifySecurityRoute("/_next/not-a-framework-endpoint", "GET")).toMatchObject({
      routeClass: "UNKNOWN_STATIC",
      terminalKind: "UNKNOWN_ROUTE",
    });
    expect(classifySecurityRoute("/_next/image", "GET").terminalKind).toBeNull();
  });
});
