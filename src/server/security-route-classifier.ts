import { statSync } from "node:fs";
import path from "node:path";
import type { SecuritySignalKind } from "@/generated/prisma/client";
import { findAccessRoute, isAccessMethodAllowed } from "@/server/access-control-inventory";

/**
 * Page routes are intentionally explicit. The contract test compares this list
 * with every app-router page so a new public surface cannot silently bypass the
 * ingress classifier.
 */
export const PUBLIC_PAGE_ROUTES = [
  "/",
  "/admin",
  "/admin/calendar",
  "/admin/dashboard",
  "/admin/forbidden",
  "/admin/login",
  "/admin/members",
  "/admin/members/[memberId]",
  "/admin/members/positions/[positionCode]",
  "/admin/members/positions/[positionCode]/qualifications",
  "/admin/notifications",
  "/admin/password-reset",
  "/admin/pilots",
  "/admin/pilots/[pilotId]",
  "/admin/qualification-config",
  "/admin/reviews",
  "/admin/reviews/[reviewId]",
  "/admin/settings",
  "/admin/upgrade-plans",
  "/admin/upgrade-plans/[planId]",
  "/admin/upgrade-plans/[planId]/edit",
  "/admin/upgrade-plans/new",
  "/deployment",
  "/dev/admin-operations",
  "/dev/admin-review",
  "/dev/layout-preview",
  "/dev/pilot-flow",
  "/dev/ui-kit",
  "/member",
  "/member/access/[token]",
  "/member/identity",
  "/member/notifications",
  "/member/qualifications",
  "/member/qualifications/[qualificationId]/update",
  "/member/security",
  "/member/submissions/[submissionId]",
  "/pilot",
  "/pilot/access/[token]",
  "/pilot/identity",
  "/pilot/notifications",
  "/pilot/qualifications",
  "/pilot/qualifications/[qualificationId]/update",
  "/pilot/security",
  "/pilot/submissions/[submissionId]",
  "/setup",
] as const;

export type SecurityRouteClassification = {
  routeClass: string;
  terminalKind: SecuritySignalKind | null;
  outcome: string;
};

const SAFE_METHOD = /^[A-Z][A-Z0-9_-]{0,31}$/;
const PAGE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function existingNextStaticAsset(pathname: string) {
  const prefix = "/_next/static/";
  if (!pathname.startsWith(prefix) || pathname.includes("%") || pathname.includes("\\"))
    return false;
  const relative = pathname.slice(prefix.length);
  if (!relative || relative.includes("\0")) return false;
  const distDir =
    process.env.CREWQUAL_DIST_DIR ??
    (process.env.NODE_ENV === "development" ? ".next-dev" : ".next");
  const root = path.resolve(process.cwd(), distDir, "static");
  const candidate = path.resolve(root, relative);
  if (!candidate.startsWith(`${root}${path.sep}`)) return false;
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function matchesTemplate(template: string, pathname: string) {
  const expected = template === "/" ? [""] : template.replace(/\/$/, "").split("/");
  const actual = pathname === "/" ? [""] : pathname.replace(/\/$/, "").split("/");
  return (
    expected.length === actual.length &&
    expected.every((segment, index) => {
      const dynamic = segment.startsWith("[") && segment.endsWith("]");
      return dynamic ? Boolean(actual[index]) : actual[index] === segment;
    })
  );
}

export function findPublicPageRoute(pathname: string): string | undefined {
  return PUBLIC_PAGE_ROUTES.find((template) => matchesTemplate(template, pathname));
}

function probeCandidate(pathname: string) {
  let decoded = pathname.toLowerCase();
  // Decode twice so nested encodings of traversal markers do not evade the
  // classifier. Invalid percent escapes remain a probe candidate as-is.
  for (let index = 0; index < 2; index++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded.replaceAll("\\", "/");
}

export function isKnownProbePath(pathname: string) {
  const candidate = probeCandidate(pathname);
  const segments = candidate.split("/").filter(Boolean);
  return (
    candidate === "/api/internal/network-access" ||
    segments.some((segment) => [".env", ".git", ".svn", ".hg"].includes(segment)) ||
    candidate.includes("/wp-admin") ||
    candidate.includes("/wp-login.php") ||
    candidate.includes("/wordpress/") ||
    candidate.includes("/cgi-bin/") ||
    candidate.includes("/vendor/phpunit/") ||
    candidate.includes("/actuator/") ||
    candidate === "/server-status" ||
    /(?:^|\/)\.\.(?:\/|$)/.test(candidate) ||
    /\.(?:php\d*|cgi)(?:\/|$)/.test(candidate)
  );
}

function publicRouteClass(subject: string, object: string) {
  const value = `API_${subject}_${object}`.replace(/[^A-Z0-9]+/gi, "_").toUpperCase();
  return value.slice(0, 64).replace(/_+$/, "") || "API_ROUTE";
}

export function classifySecurityRoute(
  pathname: string,
  method: string,
  options: { staticAssetExists?: (pathname: string) => boolean } = {},
): SecurityRouteClassification {
  const normalizedMethod = SAFE_METHOD.test(method) ? method : "INVALID";
  if (isKnownProbePath(pathname)) {
    return { routeClass: "KNOWN_PROBE", terminalKind: "KNOWN_PROBE", outcome: "KNOWN_PROBE" };
  }

  const staticAssetExists = options.staticAssetExists ?? existingNextStaticAsset;
  if (
    pathname === "/favicon.ico" ||
    pathname === "/_next/image" ||
    (pathname.startsWith("/_next/static/") && staticAssetExists(pathname))
  ) {
    return PAGE_METHODS.has(normalizedMethod)
      ? { routeClass: "STATIC_ASSET", terminalKind: null, outcome: "KNOWN_ROUTE" }
      : { routeClass: "STATIC_ASSET", terminalKind: "INVALID_METHOD", outcome: "INVALID_METHOD" };
  }

  if (pathname.startsWith("/_next/")) {
    return {
      routeClass: "UNKNOWN_STATIC",
      terminalKind: "UNKNOWN_ROUTE",
      outcome: "UNKNOWN_STATIC",
    };
  }

  if (pathname.startsWith("/api/")) {
    const route = findAccessRoute(pathname);
    if (!route) {
      return { routeClass: "UNKNOWN_API", terminalKind: "UNKNOWN_ROUTE", outcome: "UNKNOWN_API" };
    }
    const routeClass = publicRouteClass(route.subject, route.object);
    return isAccessMethodAllowed(route, normalizedMethod)
      ? { routeClass, terminalKind: null, outcome: "KNOWN_ROUTE" }
      : { routeClass, terminalKind: "INVALID_METHOD", outcome: "INVALID_METHOD" };
  }

  const page = findPublicPageRoute(pathname);
  if (!page) {
    return { routeClass: "UNKNOWN_PAGE", terminalKind: "UNKNOWN_ROUTE", outcome: "UNKNOWN_PAGE" };
  }
  const routeClass = page.startsWith("/admin")
    ? "PAGE_ADMIN"
    : page.startsWith("/member") || page.startsWith("/pilot")
      ? "PAGE_MEMBER"
      : "PAGE_PUBLIC";
  return PAGE_METHODS.has(normalizedMethod)
    ? { routeClass, terminalKind: null, outcome: "KNOWN_ROUTE" }
    : { routeClass, terminalKind: "INVALID_METHOD", outcome: "INVALID_METHOD" };
}
