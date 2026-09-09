import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  ApiError,
  assertSameOrigin,
  getRequestId,
  jsonData,
  jsonError,
  parseJson,
} from "@/server/api";
import {
  createAdminSession,
  dummyPasswordHash,
  setSessionCookies,
  verifyPassword,
} from "@/server/auth";
import { resolveTotpSecret, verifyTotp } from "@/server/crypto";
import { getPrisma } from "@/server/prisma";
import { consumeRateLimit, requestAddress } from "@/server/rate-limit";
import { getRuntimeSecurityPolicy } from "@/server/runtime-settings";
import { recordPublicSecuritySignal } from "@/server/security-request";
import { verifyAuthentication } from "@/server/webauthn";

const schema = z.object({
  email: z.string().email(),
  password: z.string().optional().default(""),
  totpCode: z.string().optional().default(""),
  fidoChallengeId: z.string().uuid().optional(),
  fidoResponse: z.unknown().optional(),
});

const dummyTotpSecret = "JBSWY3DPEHPK3PXP";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  let signalAccountIdentifier: string | null = null;
  let signalIdentity: {
    adminUserId?: string;
    unitId?: string | null;
    organizationId?: string | null;
  } | null = null;
  try {
    assertSameOrigin(request);
    const input = await parseJson(request, schema);
    const address = requestAddress(request);
    const accountKey = input.email.toLowerCase();
    signalAccountIdentifier = `admin:${accountKey}`;
    const [addressAllowed, accountAllowed] = await Promise.all([
      consumeRateLimit(`admin-login:address:${address}`, 20, 15 * 60 * 1000),
      consumeRateLimit(`admin-login:account:${accountKey}`, 10, 15 * 60 * 1000),
    ]);
    if (!addressAllowed || !accountAllowed)
      throw new ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试", 429);
    const policy = await getRuntimeSecurityPolicy();
    const db = getPrisma();
    const user = await db.adminUser.findUnique({ where: { email: input.email.toLowerCase() } });
    if (user) {
      signalIdentity = {
        adminUserId: user.id,
        unitId: user.unitId,
        organizationId: user.organizationId,
      };
    }
    const unavailable =
      !user || !user.active || (user.lockedUntil && user.lockedUntil > new Date());
    const needsPassword = policy.adminLoginMode !== "TOTP_ONLY";
    const needsTotp = policy.adminLoginMode !== "PASSWORD_ONLY";
    const passwordOk = needsPassword
      ? await verifyPassword(user?.passwordHash ?? (await dummyPasswordHash()), input.password)
      : true;
    const totpCounter = needsTotp
      ? verifyTotp(
          user ? resolveTotpSecret(user.totpSecretCiphertext) : dummyTotpSecret,
          input.totpCode,
        )
      : null;
    let credentialsOk =
      (!needsPassword || passwordOk) && (!needsTotp || (user !== null && totpCounter !== null));

    if (!unavailable && credentialsOk && needsTotp && user && totpCounter !== null) {
      const claimed = await db.adminUser.updateMany({
        where: {
          id: user.id,
          OR: [{ lastTotpCounter: null }, { lastTotpCounter: { lt: BigInt(totpCounter) } }],
        },
        data: {
          failedAttempts: 0,
          lockedUntil: null,
          totpVerifiedAt: user.totpVerifiedAt ?? new Date(),
          lastTotpCounter: BigInt(totpCounter),
        },
      });
      credentialsOk = claimed.count === 1;
    }

    if (unavailable || !credentialsOk) {
      if (user) {
        const willLock = user.failedAttempts >= policy.maxFailedAttempts - 1;
        await db.adminUser.update({
          where: { id: user.id },
          data: {
            failedAttempts: { increment: 1 },
            lockedUntil: willLock
              ? new Date(Date.now() + policy.lockoutMinutes * 60 * 1000)
              : user.lockedUntil,
          },
        });
        await db.auditEvent.create({
          data: {
            actorType: "admin",
            actorId: user.id,
            action: willLock ? "admin.account_locked" : "admin.login_failed",
            entityType: "AdminUser",
            entityId: user.id,
            detail: { locked: willLock },
            requestId,
          },
        });
      }
      throw new ApiError("INVALID_CREDENTIALS", "账号、密码或动态验证码错误", 401);
    }
    if (policy.adminFido2Required) {
      if (!user || !input.fidoResponse || typeof input.fidoResponse !== "object") {
        throw new ApiError("FIDO2_REQUIRED", "此认证配置需要 FIDO2 硬件验证器", 401);
      }
      await verifyAuthentication({
        kind: "ADMIN_AUTHENTICATION",
        ownerId: user.id,
        challengeId: input.fidoChallengeId ?? "",
        response: input.fidoResponse as never,
      });
    }
    if (!needsTotp) {
      await db.adminUser.update({
        where: { id: user.id },
        data: { failedAttempts: 0, lockedUntil: null },
      });
    }
    const session = await createAdminSession(user.id, policy);
    await db.auditEvent.create({
      data: {
        actorType: "admin",
        actorId: user.id,
        action: "admin.login_succeeded",
        entityType: "AdminSession",
        entityId: session.id,
        detail: { expiresAt: session.expiresAt.toISOString() },
        requestId,
      },
    });
    await setSessionCookies(
      await cookies(),
      "admin",
      session.rawToken,
      session.csrfToken,
      Math.max(1, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
    );
    await recordPublicSecuritySignal(request, {
      kind: "AUTH_SUCCESS",
      accountIdentifier: signalAccountIdentifier,
      identity: signalIdentity ?? undefined,
      outcome: "AUTHENTICATED",
    }).catch(() => undefined);
    return jsonData({ authenticated: true, expiresAt: session.expiresAt.toISOString() }, requestId);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 429)) {
      await recordPublicSecuritySignal(request, {
        kind: error.status === 429 ? "AUTH_RATE_LIMIT" : "AUTH_FAILURE",
        accountIdentifier: signalAccountIdentifier,
        identity: signalIdentity ?? undefined,
        outcome: error.code,
      }).catch(() => undefined);
    }
    return jsonError(error, requestId, request);
  }
}
