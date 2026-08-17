import { NextRequest, NextResponse } from "next/server";
import { isRemoteServiceMode } from "@/lib/service-mode";

const adminCookie = "crewqual_admin_session";
const pilotCookie = "crewqual_pilot_session";
const memberCookie = "crewqual_member_session";

export function middleware(request: NextRequest) {
  const remoteMode = isRemoteServiceMode();
  const { pathname } = request.nextUrl;
  if (!remoteMode && pathname.startsWith("/api/") && pathname !== "/api/health") {
    return new NextResponse(null, { status: 404 });
  }
  if (pathname.startsWith("/pilot/") || pathname.startsWith("/api/pilot/")) {
    const response = NextResponse.next();
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
    const response = NextResponse.next();
    response.headers.set("cache-control", "no-store, max-age=0");
    response.headers.set("referrer-policy", "no-referrer");
    response.headers.set("x-robots-tag", "noindex, nofollow");
    return response;
  }
  if (!remoteMode) return NextResponse.next();
  if (
    pathname.startsWith("/admin") &&
    pathname !== "/admin/login" &&
    !request.cookies.has(adminCookie)
  ) {
    const login = new URL("/admin/login", request.url);
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  if (
    (pathname === "/pilot/qualifications" ||
      pathname.startsWith("/pilot/qualifications/") ||
      pathname.startsWith("/pilot/submissions") ||
      pathname.startsWith("/pilot/notifications") ||
      pathname === "/member/qualifications" ||
      pathname.startsWith("/member/qualifications/") ||
      pathname.startsWith("/member/submissions") ||
      pathname.startsWith("/member/notifications")) &&
    !request.cookies.has(pilotCookie) &&
    !request.cookies.has(memberCookie)
  ) {
    return NextResponse.redirect(
      new URL(
        pathname.startsWith("/member/") ? "/member/identity" : "/pilot/identity",
        request.url,
      ),
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/admin/:path*",
    "/pilot/access/:path*",
    "/pilot/qualifications/:path*",
    "/pilot/submissions/:path*",
    "/pilot/notifications/:path*",
    "/member/access/:path*",
    "/member/qualifications/:path*",
    "/member/submissions/:path*",
    "/member/notifications/:path*",
  ],
};
