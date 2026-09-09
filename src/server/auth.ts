import { observeCompatibilityPath } from "@/server/compatibility-observability";
import argon2 from "argon2";
import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { ApiError } from "@/server/api";
import { createOpaqueToken, safeEqualHex, sha256 } from "@/server/crypto";
import { getPrisma } from "@/server/prisma";
import { getRuntimeSecurityPolicy, type RuntimeSecurityPolicy } from "@/server/runtime-settings";
import { getServerConfig } from "@/server/config";

export const COOKIE_NAMES = {
  admin: "crewqual_admin_session",
  pilot: "crewqual_pilot_session",
  member: "crewqual_member_session",
} as const;

export type AuthenticatedAdmin = {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  unitId: string | null;
  unitName: string | null;
  organizationId?: string | null;
  sessionId: string;
  csrfToken: string;
  expiresAt: Date;
};

export type AuthenticatedPilot = {
  id: string;
  personId: string;
  organizationId: string;
  unitId: string;
  employeeNumber: string;
  displayName: string;
  mobile: string;
  sessionId: string;
  csrfToken: string;
  authState: string;
};

export async function hashPassword(password: string) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

let dummyHashPromise: Promise<string> | null = null;
export function dummyPasswordHash() {
  dummyHashPromise ??= hashPassword("CrewQual-dummy-password-never-valid");
  return dummyHashPromise;
}

function hashCsrf(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sessionCookie(name: string, value: string, maxAge: number) {
  const secure = getServerConfig().APP_ORIGIN.startsWith("https:");
  return {
    name,
    value,
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function createAdminSession(
  userId: string,
  policyOrVersion?: RuntimeSecurityPolicy | number,
) {
  const db = getPrisma();
  const policy =
    typeof policyOrVersion === "number" || policyOrVersion === undefined
      ? await getRuntimeSecurityPolicy()
      : policyOrVersion;
  if (typeof policyOrVersion === "number" && policy.policyVersion !== policyOrVersion) {
    throw new ApiError("SECURITY_POLICY_CHANGED", "安全策略已更新，请重新登录", 409);
  }
  const rawToken = createOpaqueToken();
  const csrfToken = createOpaqueToken(24);
  const session = await db.$transaction(async (tx) => {
    // The row lock makes concurrent successful logins consume distinct summary
    // boundaries. Read the prior timestamp only after the lock is held.
    await tx.$queryRaw`SELECT "id" FROM "AdminUser" WHERE "id" = ${userId}::uuid FOR UPDATE`;
    const user = await tx.adminUser.findUnique({
      where: { id: userId },
      select: { active: true, lastSuccessfulLoginAt: true },
    });
    if (!user?.active) throw new ApiError("INVALID_CREDENTIALS", "账号不可用", 401);
    const loginAt = new Date();
    const expiresAt = new Date(loginAt.getTime() + policy.adminSessionTtlHours * 60 * 60 * 1000);
    const { since, until } = adminSecuritySummaryInterval(user.lastSuccessfulLoginAt, loginAt);
    const created = await tx.adminSession.create({
      data: {
        userId,
        tokenHash: sha256(rawToken),
        csrfTokenHash: hashCsrf(csrfToken),
        expiresAt,
        policyVersion: policy.policyVersion,
        securitySummarySince: since,
        securitySummaryUntil: until,
      },
    });
    await tx.adminUser.update({
      where: { id: userId },
      data: { lastSuccessfulLoginAt: loginAt },
    });
    return created;
  });
  return {
    id: session.id,
    rawToken,
    csrfToken,
    expiresAt: session.expiresAt,
    securitySummarySince: session.securitySummarySince,
    securitySummaryUntil: session.securitySummaryUntil,
  };
}

const SECURITY_SUMMARY_MAX_MS = 30 * 24 * 60 * 60_000;
const SECURITY_SUMMARY_FIRST_LOGIN_MS = 24 * 60 * 60_000;

export function adminSecuritySummaryInterval(previousLoginAt: Date | null, loginAt: Date) {
  const until = new Date(Math.floor(loginAt.getTime() / 60_000) * 60_000);
  const earliest = until.getTime() - SECURITY_SUMMARY_MAX_MS;
  const prior = previousLoginAt
    ? Math.floor(previousLoginAt.getTime() / 60_000) * 60_000
    : until.getTime() - SECURITY_SUMMARY_FIRST_LOGIN_MS;
  return {
    since: new Date(Math.min(until.getTime(), Math.max(earliest, prior))),
    until,
  };
}

export async function createPilotSession(
  pilotId: string,
  authState: "AUTHENTICATED" | "PENDING_SECOND_FACTOR" = "AUTHENTICATED",
  policyOrVersion?: RuntimeSecurityPolicy | number,
) {
  const db = getPrisma();
  const policy =
    typeof policyOrVersion === "number" || policyOrVersion === undefined
      ? await getRuntimeSecurityPolicy()
      : policyOrVersion;
  if (typeof policyOrVersion === "number" && policy.policyVersion !== policyOrVersion) {
    throw new ApiError("SECURITY_POLICY_CHANGED", "安全策略已更新，请重新登录", 409);
  }
  const rawToken = createOpaqueToken();
  const csrfToken = createOpaqueToken(24);
  const expiresAt = new Date(Date.now() + policy.pilotSessionTtlMinutes * 60 * 1000);
  await db.pilotSession.create({
    data: {
      pilotId,
      tokenHash: sha256(rawToken),
      csrfTokenHash: hashCsrf(csrfToken),
      expiresAt,
      authState,
      policyVersion: policy.policyVersion,
    },
  });
  return { rawToken, csrfToken, expiresAt };
}

export async function setSessionCookies(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  kind: "admin" | "pilot",
  token: string,
  csrfToken: string,
  maxAge: number,
) {
  const secure = getServerConfig().APP_ORIGIN.startsWith("https:");
  cookieStore.set(sessionCookie(COOKIE_NAMES[kind], token, maxAge));
  cookieStore.set({
    name: `${COOKIE_NAMES[kind]}_csrf`,
    value: csrfToken,
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  if (kind === "pilot") {
    // During the compatibility window both names are issued. New member
    // routes can migrate independently while old pilot links remain valid.
    cookieStore.set(sessionCookie(COOKIE_NAMES.member, token, maxAge));
    cookieStore.set({
      name: `${COOKIE_NAMES.member}_csrf`,
      value: csrfToken,
      httpOnly: false,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge,
    });
  }
}

export async function authenticateAdmin(request?: NextRequest): Promise<AuthenticatedAdmin> {
  const db = getPrisma();
  const token =
    request?.cookies.get(COOKIE_NAMES.admin)?.value ??
    (await cookies()).get(COOKIE_NAMES.admin)?.value;
  if (!token) throw new ApiError("UNAUTHENTICATED", "请先登录", 401);
  const session = await db.adminSession.findFirst({
    where: { tokenHash: sha256(token), expiresAt: { gt: new Date() }, user: { active: true } },
    include: {
      user: {
        include: {
          unit: true,
          roles: {
            include: { role: { include: { permissions: { include: { permission: true } } } } },
          },
        },
      },
    },
  });
  if (!session) throw new ApiError("UNAUTHENTICATED", "登录已失效，请重新登录", 401);
  const now = new Date();
  if (now.getTime() - session.lastSeenAt.getTime() >= 15 * 60 * 1000) {
    await db.adminSession.deleteMany({ where: { id: session.id } });
    throw new ApiError("SESSION_IDLE_TIMEOUT", "会话已因长时间空闲而结束，请重新登录", 401);
  }
  const adminPolicy = await getRuntimeSecurityPolicy();
  const adminSessionState = (session as typeof session & { policyVersion?: number }).policyVersion;
  if (adminSessionState !== undefined && adminSessionState !== adminPolicy.policyVersion) {
    await db.adminSession.deleteMany({ where: { id: session.id } });
    throw new ApiError("UNAUTHENTICATED", "安全策略已更新，请重新登录", 401);
  }
  const lastSeen = (session as typeof session & { lastSeenAt: Date }).lastSeenAt;
  if (now.getTime() - lastSeen.getTime() >= 5 * 60 * 1000) {
    await db.adminSession.updateMany({
      where: { id: session.id, lastSeenAt: { lt: new Date(now.getTime() - 5 * 60 * 1000) } },
      data: { lastSeenAt: now },
    });
  }
  const roleCodes = session.user.roles.map((entry: { role: { code: string } }) => entry.role.code);
  const permissionCodes = session.user.roles.flatMap(
    (entry: { role: { permissions: Array<{ permission: { code: string } }> } }) =>
      entry.role.permissions.map((permission) => permission.permission.code),
  );
  return {
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.displayName,
    roles: roleCodes,
    permissions: [...new Set(permissionCodes)],
    unitId: session.user.unitId,
    unitName: session.user.unit?.name ?? null,
    // During the additive migration organizations reuse the legacy root-unit
    // id, so the fallback keeps template installation scoped for old sessions.
    organizationId: session.user.organizationId ?? session.user.unitId,
    sessionId: session.id,
    csrfToken: session.csrfTokenHash,
    expiresAt: session.expiresAt,
  };
}

export async function authenticatePilot(
  request?: NextRequest,
  options: { allowPending?: boolean } = {},
): Promise<AuthenticatedPilot> {
  const db = getPrisma();
  const cookieStore = request?.cookies ?? (await cookies());
  const memberToken = cookieStore.get(COOKIE_NAMES.member)?.value;
  const token = memberToken ?? cookieStore.get(COOKIE_NAMES.pilot)?.value;
  if (!token) throw new ApiError("UNAUTHENTICATED", "请先通过访问链接登录", 401);
  const session = await db.pilotSession.findFirst({
    where: {
      tokenHash: sha256(token),
      expiresAt: { gt: new Date() },
      pilot: { active: true },
    },
    include: {
      pilot: {
        include: {
          unit: true,
          profile: true,
          person: { include: { pilotProfile: true } },
        },
      },
    },
  });
  if (!session) throw new ApiError("UNAUTHENTICATED", "访问链接已失效，请重新获取", 401);
  const { pilot } = session;
  const person = pilot.person;
  const profile = person?.pilotProfile;
  if (
    !pilot.active ||
    !person?.active ||
    !pilot.personId ||
    pilot.personId !== person.id ||
    !person.organizationId ||
    !person.unitId ||
    person.unitId !== pilot.unitId ||
    !pilot.unit ||
    pilot.unit.id !== person.unitId ||
    pilot.unit.organizationId !== person.organizationId ||
    !profile ||
    profile.personId !== person.id ||
    profile.legacyPilotId !== pilot.id ||
    !pilot.profile ||
    pilot.profile.id !== profile.id ||
    pilot.profile.personId !== person.id ||
    pilot.profile.legacyPilotId !== pilot.id
  ) {
    throw new ApiError("MEMBER_IDENTITY_INVALID", "成员身份关联无效，请联系管理员", 403);
  }
  const pilotPolicy = await getRuntimeSecurityPolicy();
  const authState =
    (session as typeof session & { authState?: string }).authState ?? "AUTHENTICATED";
  if (authState !== "AUTHENTICATED" && !options.allowPending) {
    throw new ApiError("ADDITIONAL_FACTOR_REQUIRED", "请完成额外认证后再访问资质", 401);
  }
  const policyVersion = (session as typeof session & { policyVersion?: number }).policyVersion;
  if (policyVersion !== undefined && policyVersion !== pilotPolicy.policyVersion) {
    await db.pilotSession.deleteMany({ where: { id: session.id } });
    throw new ApiError("UNAUTHENTICATED", "安全策略已更新，请重新登录", 401);
  }
  if (!memberToken) observeCompatibilityPath("legacy_cookie");
  if (request && new URL(request.url).pathname.startsWith("/api/pilot/"))
    observeCompatibilityPath("legacy_api");
  const now = new Date();
  const lastSeen = (session as typeof session & { lastSeenAt: Date }).lastSeenAt;
  if (now.getTime() - lastSeen.getTime() >= 30 * 60 * 1000) {
    await db.pilotSession.deleteMany({ where: { id: session.id } });
    throw new ApiError("SESSION_IDLE_TIMEOUT", "会话已因长时间空闲而结束，请重新登录", 401);
  }
  if (now.getTime() - lastSeen.getTime() >= 5 * 60 * 1000) {
    await db.pilotSession.updateMany({
      where: { id: session.id, lastSeenAt: { lt: new Date(now.getTime() - 5 * 60 * 1000) } },
      data: { lastSeenAt: now },
    });
  }
  return {
    id: session.pilot.id,
    personId: person.id,
    organizationId: person.organizationId,
    unitId: person.unitId,
    employeeNumber: session.pilot.employeeNumber,
    displayName: session.pilot.displayName,
    mobile: session.pilot.mobile,
    sessionId: session.id,
    csrfToken: session.csrfTokenHash,
    authState,
  };
}

/**
 * A magic link can open a restricted enrollment session when the active member
 * policy requires a password, TOTP, or FIDO2. Promote that session only after
 * every factor required by the policy has been bound. The enrollment session
 * never grants access to member data while it is pending.
 */
export async function refreshPilotEnrollment(sessionId: string, pilotId: string) {
  const db = getPrisma();
  const [policy, pilot, fidoCount] = await Promise.all([
    getRuntimeSecurityPolicy(),
    db.pilot.findUnique({
      where: { id: pilotId },
      select: { passwordHash: true, totpSecretCiphertext: true, totpVerifiedAt: true },
    }),
    db.fidoCredential.count({ where: { pilotId } }),
  ]);
  if (!pilot) return false;
  if (policy.memberLoginMode === "SMS_LINK") return true;
  const passwordReady = Boolean(pilot.passwordHash);
  const totpReady =
    policy.memberLoginMode === "PASSWORD_TOTP"
      ? Boolean(pilot.totpSecretCiphertext && pilot.totpVerifiedAt)
      : true;
  const fidoReady =
    policy.memberFido2Required || policy.memberLoginMode === "PASSWORD_FIDO2"
      ? fidoCount > 0
      : true;
  if (!passwordReady || !totpReady || !fidoReady) return false;
  const promoted = await db.pilotSession.updateMany({
    where: { id: sessionId, pilotId, authState: { not: "AUTHENTICATED" } },
    data: { authState: "AUTHENTICATED" },
  });
  return promoted.count === 1;
}

export async function pilotHasFactors(pilotId: string) {
  const db = getPrisma();
  const [pilot, fidoCount] = await Promise.all([
    db.pilot.findUnique({
      where: { id: pilotId },
      select: { passwordHash: true, totpSecretCiphertext: true },
    }),
    typeof (db as { fidoCredential?: { count?: unknown } }).fidoCredential?.count === "function"
      ? db.fidoCredential.count({ where: { pilotId } })
      : Promise.resolve(0),
  ]);
  return {
    password: Boolean(pilot?.passwordHash),
    totp: Boolean(pilot?.totpSecretCiphertext),
    fido: fidoCount > 0,
    any: Boolean(pilot?.passwordHash || pilot?.totpSecretCiphertext || fidoCount > 0),
  };
}

export function requirePermission(user: AuthenticatedAdmin, permission: string) {
  if (user.roles.includes("SUPER_ADMIN") || user.permissions.includes(permission)) return;
  throw new ApiError("FORBIDDEN", "没有执行此操作的权限", 403);
}

export async function assertCsrf(request: NextRequest, expectedHash: string) {
  const provided = request.headers.get("x-csrf-token") ?? "";
  if (!provided || !expectedHash || !safeEqualHex(hashCsrf(provided), expectedHash)) {
    throw new ApiError("CSRF_FAILED", "请求校验失败，请刷新页面后重试", 403);
  }
}

export async function consumePilotAccessToken(rawToken: string, requestId: string = randomUUID()) {
  const db = getPrisma();
  const policy = await getRuntimeSecurityPolicy();
  const tokenHash = sha256(rawToken);
  const now = new Date();
  const rawSessionToken = createOpaqueToken();
  const csrfToken = createOpaqueToken(24);
  const expiresAt = new Date(now.getTime() + policy.pilotSessionTtlMinutes * 60 * 1000);
  const outcome = await db.$transaction(async (tx) => {
    const token = await tx.pilotAccessToken.findUnique({
      where: { tokenHash },
      include: { pilot: true },
    });
    if (!token) {
      await tx.auditEvent.create({
        data: {
          actorType: "pilot",
          action: "pilot_access_token.invalid",
          entityType: "PilotAccessToken",
          entityId: tokenHash,
          detail: {},
          requestId,
        },
      });
      return { error: new ApiError("INVALID_ACCESS_TOKEN", "访问链接无效", 401) };
    }
    if (token.pilot.active === false) {
      await tx.auditEvent.create({
        data: {
          actorType: "pilot",
          pilotId: token.pilot.id,
          action: "pilot_access_token.inactive_pilot",
          entityType: "PilotAccessToken",
          entityId: token.id,
          detail: {},
          requestId,
        },
      });
      return { error: new ApiError("PILOT_INACTIVE", "人员账号已停用", 403) };
    }
    const tokenPolicyVersion = (token as typeof token & { policyVersion?: number }).policyVersion;
    if (tokenPolicyVersion !== undefined && tokenPolicyVersion !== policy.policyVersion) {
      await tx.auditEvent.create({
        data: {
          actorType: "pilot",
          pilotId: token.pilot.id,
          action: "pilot_access_token.policy_changed",
          entityType: "PilotAccessToken",
          entityId: token.id,
          detail: { tokenPolicyVersion, activePolicyVersion: policy.policyVersion },
          requestId,
        },
      });
      return {
        error: new ApiError("ACCESS_TOKEN_POLICY_CHANGED", "访问链接已失效，请重新获取", 401),
      };
    }
    if (token.consumedAt) {
      await tx.auditEvent.create({
        data: {
          actorType: "pilot",
          pilotId: token.pilot.id,
          action: "pilot_access_token.replayed",
          entityType: "PilotAccessToken",
          entityId: token.id,
          detail: {},
          requestId,
        },
      });
      return { error: new ApiError("ACCESS_TOKEN_USED", "访问链接已被使用", 401) };
    }
    if (token.expiresAt <= now) {
      await tx.auditEvent.create({
        data: {
          actorType: "pilot",
          pilotId: token.pilot.id,
          action: "pilot_access_token.expired",
          entityType: "PilotAccessToken",
          entityId: token.id,
          detail: {},
          requestId,
        },
      });
      return { error: new ApiError("ACCESS_TOKEN_EXPIRED", "访问链接已过期", 401) };
    }
    const consumed = await tx.pilotAccessToken.updateMany({
      where: { id: token.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      await tx.auditEvent.create({
        data: {
          actorType: "pilot",
          pilotId: token.pilot.id,
          action: "pilot_access_token.replayed",
          entityType: "PilotAccessToken",
          entityId: token.id,
          detail: { concurrent: true },
          requestId,
        },
      });
      return { error: new ApiError("ACCESS_TOKEN_USED", "访问链接已被使用", 401) };
    }
    await tx.pilotSession.create({
      data: {
        pilotId: token.pilot.id,
        tokenHash: sha256(rawSessionToken),
        csrfTokenHash: hashCsrf(csrfToken),
        expiresAt,
        authState: policy.memberLoginMode === "SMS_LINK" ? "AUTHENTICATED" : "PENDING_ENROLLMENT",
        policyVersion: policy.policyVersion,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorType: "pilot",
        pilotId: token.pilot.id,
        action: "pilot_access_token.consumed",
        entityType: "PilotAccessToken",
        entityId: token.id,
        detail: {
          sessionExpiresAt: expiresAt.toISOString(),
          authState: policy.memberLoginMode === "SMS_LINK" ? "AUTHENTICATED" : "PENDING_ENROLLMENT",
        },
        requestId,
      },
    });
    return {
      session: {
        rawToken: rawSessionToken,
        csrfToken,
        expiresAt,
        authState: policy.memberLoginMode === "SMS_LINK" ? "AUTHENTICATED" : "PENDING_ENROLLMENT",
        pilotId: token.pilot.id,
        personId: token.pilot.personId,
        unitId: token.pilot.unitId,
      },
    };
  });
  if ("error" in outcome) throw outcome.error;
  return outcome.session;
}

export function looksLikeMagicLink(value: string) {
  return /^[A-Za-z0-9_-]{32,64}$/.test(value);
}
