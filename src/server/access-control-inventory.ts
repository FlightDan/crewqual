/** Reviewed API surface. This inventory classifies traffic; it never grants access.
 * Add every route and exported HTTP method explicitly. The AST contract test
 * rejects missing/stale entries, including aliases and newly added methods.
 */
export type AccessSubject = "admin" | "member" | "anonymous" | "setup" | "service";
export type AccessScope =
  | "permission-and-unit"
  | "permission-and-organization"
  | "operation-specific"
  | "owner"
  | "global-permission"
  | "session"
  | "bootstrap"
  | "public"
  | "service-secret";
export type AccessMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "HEAD" | "OPTIONS";
export type AccessRoute = {
  route: string;
  methods: readonly AccessMethod[];
  subject: AccessSubject;
  object: string;
  scope: AccessScope;
  actions: Readonly<Partial<Record<AccessMethod, string>>>;
};
function route(
  route: string,
  methods: readonly AccessMethod[],
  subject: AccessSubject,
  object: string,
  scope: AccessScope,
): AccessRoute {
  return {
    route,
    methods,
    subject,
    object,
    scope,
    actions: Object.fromEntries(
      methods.map((method) => [
        method,
        method === "GET" || method === "HEAD" ? "read" : method === "DELETE" ? "delete" : "mutate",
      ]),
    ),
  };
}

export const ACCESS_ROUTE_INVENTORY: readonly AccessRoute[] = [
  route(
    "/api/admin/backups",
    ["GET", "POST", "PATCH"],
    "admin",
    "system-configuration",
    "global-permission",
  ),
  route("/api/admin/calendar/[id]", ["GET"], "admin", "calendar", "permission-and-unit"),
  route("/api/admin/calendar/qualifications", ["GET"], "admin", "calendar", "permission-and-unit"),
  route("/api/admin/calendar", ["GET"], "admin", "calendar", "permission-and-unit"),
  route("/api/admin/dashboard", ["GET"], "admin", "dashboard", "permission-and-unit"),
  route("/api/admin/login/fido-options", ["POST"], "anonymous", "admin-authentication", "public"),
  route("/api/admin/login", ["POST"], "anonymous", "admin-authentication", "public"),
  route("/api/admin/logout", ["POST"], "admin", "admin-session-and-factors", "session"),
  route(
    "/api/admin/media-optimization",
    ["GET", "PATCH"],
    "admin",
    "system-configuration",
    "global-permission",
  ),
  route(
    "/api/admin/members/[memberId]/positions/[assignmentId]",
    ["PATCH"],
    "admin",
    "members",
    "permission-and-unit",
  ),
  route(
    "/api/admin/members/[memberId]/positions",
    ["POST"],
    "admin",
    "members",
    "permission-and-unit",
  ),
  route("/api/admin/members/[memberId]", ["GET"], "admin", "members", "permission-and-unit"),
  route("/api/admin/members/positions", ["GET"], "admin", "members", "permission-and-unit"),
  route("/api/admin/members", ["GET"], "admin", "members", "permission-and-unit"),
  route(
    "/api/admin/notifications/[id]/retry",
    ["POST"],
    "admin",
    "notifications",
    "permission-and-unit",
  ),
  route("/api/admin/notifications/[id]", ["GET"], "admin", "notifications", "permission-and-unit"),
  route("/api/admin/notifications/inbox/[id]/read", ["POST"], "admin", "admin-inbox", "session"),
  route("/api/admin/notifications/inbox", ["GET"], "admin", "admin-inbox", "session"),
  route("/api/admin/notifications", ["GET"], "admin", "notifications", "permission-and-unit"),
  route(
    "/api/admin/notifications/summary",
    ["GET"],
    "admin",
    "notifications",
    "permission-and-unit",
  ),
  route(
    "/api/admin/password-reset",
    ["GET", "POST"],
    "anonymous",
    "admin-authentication",
    "public",
  ),
  route(
    "/api/admin/pilots/[pilotId]/qualifications/[qualificationId]",
    ["POST", "PATCH"],
    "admin",
    "pilots",
    "permission-and-unit",
  ),
  route("/api/admin/pilots/[pilotId]", ["GET", "PATCH"], "admin", "pilots", "permission-and-unit"),
  route("/api/admin/pilots/export", ["GET"], "admin", "pilots", "permission-and-unit"),
  route("/api/admin/pilots/import", ["POST"], "admin", "pilots", "permission-and-unit"),
  route("/api/admin/pilots/import-preview", ["POST"], "admin", "pilots", "permission-and-unit"),
  route("/api/admin/pilots/import-template", ["GET"], "admin", "pilots", "permission-and-unit"),
  route("/api/admin/pilots/meta", ["GET"], "admin", "pilots", "permission-and-unit"),
  route("/api/admin/pilots", ["GET", "POST"], "admin", "pilots", "permission-and-unit"),
  route(
    "/api/admin/qualification-configs/[id]",
    ["GET"],
    "admin",
    "qualification-configs",
    "permission-and-organization",
  ),
  route(
    "/api/admin/qualification-configs",
    ["GET", "PATCH", "POST"],
    "admin",
    "qualification-configs",
    "permission-and-organization",
  ),
  route(
    "/api/admin/qualification-definitions",
    ["GET", "POST", "PATCH"],
    "admin",
    "organization-configuration",
    "permission-and-organization",
  ),
  route(
    "/api/admin/qualification-records/[recordId]/rollback",
    ["POST"],
    "admin",
    "qualification-records",
    "permission-and-unit",
  ),
  route(
    "/api/admin/reviews/[reviewId]/approve",
    ["POST"],
    "admin",
    "reviews",
    "permission-and-unit",
  ),
  route(
    "/api/admin/reviews/[reviewId]/correction",
    ["POST"],
    "admin",
    "reviews",
    "permission-and-unit",
  ),
  route(
    "/api/admin/reviews/[reviewId]/return",
    ["POST"],
    "admin",
    "reviews",
    "permission-and-unit",
  ),
  route(
    "/api/admin/reviews/[reviewId]/evidence",
    ["GET"],
    "admin",
    "reviews",
    "permission-and-unit",
  ),
  route("/api/admin/reviews/[reviewId]", ["GET"], "admin", "reviews", "permission-and-unit"),
  route("/api/admin/reviews", ["GET"], "admin", "reviews", "permission-and-unit"),
  route("/api/admin/security/fido", ["POST"], "admin", "admin-session-and-factors", "session"),
  route("/api/admin/security/summary", ["GET"], "admin", "security-telemetry", "global-permission"),
  route("/api/admin/security/trends", ["GET"], "admin", "security-telemetry", "global-permission"),
  route(
    "/api/admin/security/detections",
    ["GET"],
    "admin",
    "security-telemetry",
    "global-permission",
  ),
  route("/api/admin/session", ["GET"], "admin", "admin-session-and-factors", "session"),
  route(
    "/api/admin/settings",
    ["GET", "PATCH", "POST"],
    "admin",
    "system-configuration",
    "operation-specific",
  ),
  route(
    "/api/admin/settings/storage",
    ["GET", "POST", "PATCH"],
    "admin",
    "system-configuration",
    "global-permission",
  ),
  route(
    "/api/admin/system-updates",
    ["GET", "POST"],
    "admin",
    "system-configuration",
    "global-permission",
  ),
  route(
    "/api/admin/template-packs/[templatePackId]/install",
    ["POST"],
    "admin",
    "organization-configuration",
    "permission-and-organization",
  ),
  route(
    "/api/admin/template-packs",
    ["GET", "POST"],
    "admin",
    "organization-configuration",
    "operation-specific",
  ),
  route(
    "/api/admin/upgrade-plans/[id]/[action]",
    ["POST"],
    "admin",
    "upgrade-plans",
    "permission-and-unit",
  ),
  route(
    "/api/admin/upgrade-plans/[id]/reassign",
    ["POST"],
    "admin",
    "upgrade-plans",
    "permission-and-unit",
  ),
  route(
    "/api/admin/upgrade-plans/[id]",
    ["GET", "PATCH"],
    "admin",
    "upgrade-plans",
    "permission-and-unit",
  ),
  route(
    "/api/admin/upgrade-plans/[id]/stages/[stageId]/[action]",
    ["POST"],
    "admin",
    "upgrade-plans",
    "permission-and-unit",
  ),
  route(
    "/api/admin/upgrade-plans/inspection-items",
    ["GET"],
    "admin",
    "upgrade-plans",
    "permission-and-unit",
  ),
  route(
    "/api/admin/upgrade-plans",
    ["GET", "POST"],
    "admin",
    "upgrade-plans",
    "permission-and-unit",
  ),
  route("/api/dev/pilot-access", ["GET"], "anonymous", "development-access-link", "public"),
  route("/api/evidence-images/[id]/recognitions", ["POST"], "member", "evidence-image", "owner"),
  route("/api/evidence-images/[id]/url", ["GET"], "member", "evidence-image", "owner"),
  route("/api/evidence-images", ["POST"], "member", "evidence-image", "owner"),
  route("/api/health", ["GET"], "anonymous", "operational-status", "public"),
  route(
    "/api/internal/network-access",
    ["GET"],
    "service",
    "network-access-policy",
    "service-secret",
  ),
  route("/api/member/access-link", ["POST"], "anonymous", "member-authentication", "public"),
  route("/api/member/login/fido-options", ["POST"], "anonymous", "member-authentication", "public"),
  route("/api/member/login", ["POST"], "anonymous", "member-authentication", "public"),
  route("/api/member/notifications/[id]", ["PATCH"], "member", "notifications", "owner"),
  route("/api/member/notifications", ["GET"], "member", "notifications", "owner"),
  route(
    "/api/member/qualifications/[qualificationId]",
    ["GET"],
    "member",
    "qualifications",
    "owner",
  ),
  route("/api/member/qualifications", ["GET"], "member", "qualifications", "owner"),
  route("/api/member/security/fido", ["POST"], "member", "member-session-and-factors", "session"),
  route(
    "/api/member/security/password",
    ["POST"],
    "member",
    "member-session-and-factors",
    "session",
  ),
  route(
    "/api/member/security/sessions",
    ["GET", "DELETE"],
    "member",
    "member-session-and-factors",
    "session",
  ),
  route("/api/member/security/totp", ["POST"], "member", "member-session-and-factors", "session"),
  route("/api/member/session", ["GET", "POST"], "member", "member-session-and-factors", "session"),
  route("/api/member/submissions/[id]", ["GET"], "member", "submissions", "owner"),
  route("/api/member/submissions", ["POST"], "member", "submissions", "owner"),
  route("/api/pilot/access-link", ["POST"], "anonymous", "member-authentication", "public"),
  route("/api/pilot/login/fido-options", ["POST"], "anonymous", "member-authentication", "public"),
  route("/api/pilot/login", ["POST"], "anonymous", "member-authentication", "public"),
  route("/api/pilot/logout", ["POST"], "member", "member-session-and-factors", "session"),
  route("/api/pilot/notifications/[id]", ["GET", "PATCH"], "member", "notifications", "owner"),
  route("/api/pilot/notifications", ["GET"], "member", "notifications", "owner"),
  route(
    "/api/pilot/qualifications/[qualificationId]",
    ["GET"],
    "member",
    "qualifications",
    "owner",
  ),
  route("/api/pilot/qualifications", ["GET"], "member", "qualifications", "owner"),
  route("/api/pilot/security/fido", ["POST"], "member", "member-session-and-factors", "session"),
  route(
    "/api/pilot/security/password",
    ["POST"],
    "member",
    "member-session-and-factors",
    "session",
  ),
  route(
    "/api/pilot/security/sessions",
    ["GET", "DELETE"],
    "member",
    "member-session-and-factors",
    "session",
  ),
  route("/api/pilot/security/totp", ["POST"], "member", "member-session-and-factors", "session"),
  route("/api/pilot/session", ["GET", "POST"], "member", "member-session-and-factors", "session"),
  route("/api/pilot/submissions/[id]", ["GET"], "member", "submissions", "owner"),
  route("/api/pilot/submissions", ["POST"], "member", "submissions", "owner"),
  route("/api/recognitions/[id]", ["GET"], "member", "recognition-result", "owner"),
  route("/api/security/csp-report", ["POST"], "anonymous", "csp-report", "public"),
  route("/api/setup/authorize", ["POST", "DELETE"], "setup", "initial-configuration", "bootstrap"),
  route("/api/setup/backup-test", ["POST"], "setup", "initial-configuration", "bootstrap"),
  route("/api/setup/complete", ["POST"], "setup", "initial-configuration", "bootstrap"),
  route("/api/setup/fido", ["POST"], "setup", "initial-configuration", "bootstrap"),
  route("/api/setup", ["GET"], "setup", "initial-configuration", "bootstrap"),
  route("/api/setup/storage-test", ["POST"], "setup", "initial-configuration", "bootstrap"),
  route("/api/setup/totp", ["POST"], "setup", "initial-configuration", "bootstrap"),
  route("/api/setup/totp/verify", ["POST"], "setup", "initial-configuration", "bootstrap"),
  route("/api/webhooks/sms/receipt", ["POST"], "service", "sms-delivery-receipt", "service-secret"),
];

/** Literal routes win over parameter routes, matching Next's route precedence. */
export function findAccessRoute(pathname: string): AccessRoute | undefined {
  if (!pathname.startsWith("/api/") || pathname.includes("?") || pathname.includes("#"))
    return undefined;
  const segments = pathname.replace(/\/$/, "").split("/");
  let match: AccessRoute | undefined;
  let specificity = "";
  for (const entry of ACCESS_ROUTE_INVENTORY) {
    const template = entry.route.split("/");
    if (template.length !== segments.length) continue;
    let rank = "";
    const matches = template.every((part, index) => {
      const dynamic = part.startsWith("[") && part.endsWith("]");
      rank += dynamic ? "0" : "1";
      return dynamic ? Boolean(segments[index]) : part === segments[index];
    });
    if (matches && (!match || rank > specificity)) {
      match = entry;
      specificity = rank;
    }
  }
  return match;
}

/** Next supplies HEAD for GET routes and OPTIONS for every route handler. */
export function isAccessMethodAllowed(entry: AccessRoute, method: string): boolean {
  return (
    method === "OPTIONS" ||
    (method === "HEAD" && entry.methods.includes("GET")) ||
    entry.methods.some((allowed) => allowed === method)
  );
}
