import { NextRequest, NextResponse } from "next/server";
import { isRemoteServiceMode } from "@/lib/service-mode";

const adminCookie = "crewqual_admin_session";
const pilotCookie = "crewqual_pilot_session";
const memberCookie = "crewqual_member_session";

function contentSecurityPolicy(nonce: string) {
  const development = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-eval'" : ""}`,
    `connect-src 'self'${development ? " ws: wss:" : ""}`,
    "report-uri /api/security/csp-report",
  ].join("; ");
}

function securityHeaders(response: NextResponse, nonce: string) {
  const csp = contentSecurityPolicy(nonce);
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

function nextResponse(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const nonce = crypto.randomUUID().replaceAll("-", "");
  requestHeaders.set("x-nonce", nonce);
  // Next's renderer reads the request CSP to attach the nonce to its inline
  // bootstrap and hydration scripts. The response policy alone is too late.
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  return {
    nonce,
    response: securityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), nonce),
  };
}

export function middleware(request: NextRequest) {
  const { nonce, response: defaultResponse } = nextResponse(request);
  const remoteMode = isRemoteServiceMode();
  const { pathname } = request.nextUrl;
  if (
    process.env.CREWQUAL_MAINTENANCE_MODE === "1" &&
    pathname.startsWith("/api/") &&
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    pathname !== "/api/health"
  ) {
    return securityHeaders(
      NextResponse.json(
        { error: { code: "MAINTENANCE", message: "系统正在维护，请稍后重试" } },
        { status: 503, headers: { "retry-after": "60", "cache-control": "no-store" } },
      ),
      nonce,
    );
  }
  if (!remoteMode && pathname.startsWith("/api/") && pathname !== "/api/health") {
    return securityHeaders(new NextResponse(null, { status: 404 }), nonce);
  }
  if (pathname.startsWith("/pilot/") || pathname.startsWith("/api/pilot/")) {
    const response = defaultResponse;
    response.headers.set("deprecation", "true");
    response.headers.set("link", '</member>; rel="successor-version"');
    if (pathname.startsWith("/pilot/access/")) {
      response.headers.set("cache-control", "no-store, max-age=0");
      response.headers.set("referrer-policy", "no-referrer");
      response.headers.set("x-robots-tag", "noindex, nofollow");
    }
    return response;
  }
  if (pathname.startsWith("/member/access/")) {
    const response = defaultResponse;
    response.headers.set("cache-control", "no-store, max-age=0");
    response.headers.set("referrer-policy", "no-referrer");
    response.headers.set("x-robots-tag", "noindex, nofollow");
    return response;
  }
  if (!remoteMode) return defaultResponse;
  if (
    pathname.startsWith("/admin") &&
    pathname !== "/admin/login" &&
    pathname !== "/admin/password-reset" &&
    !request.cookies.has(adminCookie)
  ) {
    const login = new URL("/admin/login", request.url);
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return securityHeaders(NextResponse.redirect(login), nonce);
  }
  if (
    (pathname === "/pilot/qualifications" ||
      pathname.startsWith("/pilot/qualifications/") ||
      pathname.startsWith("/pilot/security") ||
      pathname.startsWith("/pilot/submissions") ||
      pathname.startsWith("/pilot/notifications") ||
      pathname === "/member/qualifications" ||
      pathname.startsWith("/member/qualifications/") ||
      pathname.startsWith("/member/security") ||
      pathname.startsWith("/member/submissions") ||
      pathname.startsWith("/member/notifications")) &&
    !request.cookies.has(pilotCookie) &&
    !request.cookies.has(memberCookie)
  ) {
    return securityHeaders(
      NextResponse.redirect(
        new URL(
          pathname.startsWith("/member/") ? "/member/identity" : "/pilot/identity",
          request.url,
        ),
      ),
      nonce,
    );
  }
  return defaultResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
