import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  assertSameOrigin,
  getRequestId,
  jsonData,
  jsonError,
  parseJson,
  ApiError,
} from "@/server/api";
import {
  createPilotSession,
  authenticatePilot,
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
  employeeNumber: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  fidoChallengeId: z.string().uuid().optional(),
  fidoResponse: z.unknown().optional(),
});

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  let signalAccountIdentifier: string | null = null;
  let signalIdentity: {
    pilotId?: string;
    personId?: string | null;
    unitId?: string | null;
    organizationId?: string | null;
  } | null = null;
  try {
    assertSameOrigin(request);
    await authenticatePilot(request).catch(() => null);
    const input = await parseJson(request, schema);
    signalAccountIdentifier = `member:${input.employeeNumber.trim().toLowerCase()}`;
    const policy = await getRuntimeSecurityPolicy();
    if (policy.memberLoginMode === "SMS_LINK") {
      throw new ApiError(
        "MEMBER_SMS_LOGIN_ACTIVE",
        "当前认证目标使用短信登录，请通过短信链接访问",
        409,
      );
    }
    const [addressAllowed, accountAllowed] = await Promise.all([
      consumeRateLimit(`pilot-login:address:${requestAddress(request)}`, 20, 15 * 60 * 1000),
      consumeRateLimit(
        `pilot-login:employee:${input.employeeNumber.toLowerCase()}`,
        10,
        15 * 60 * 1000,
      ),
    ]);
    if (!addressAllowed || !accountAllowed)
      throw new ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试", 429);
    const pilot = await getPrisma().pilot.findUnique({
      where: { employeeNumber: input.employeeNumber },
      include: { unit: { select: { organizationId: true } } },
    });
    if (pilot) {
      signalIdentity = {
        pilotId: pilot.id,
        personId: pilot.personId,
        unitId: pilot.unitId,
        organizationId: pilot.unit.organizationId,
      };
    }
    const passwordOk = await verifyPassword(
      pilot?.passwordHash ?? (await dummyPasswordHash()),
      input.password,
    );
    if (!pilot || !pilot.active || !passwordOk) {
      throw new ApiError("INVALID_CREDENTIALS", "工号或密码错误", 401);
    }
    const needsTotp = policy.memberLoginMode === "PASSWORD_TOTP";
    if (needsTotp) {
      if (!pilot.totpSecretCiphertext || !input.totpCode) {
        throw new ApiError("TOTP_REQUIRED", "此认证配置需要动态验证码", 401);
      }
      const counter = verifyTotp(resolveTotpSecret(pilot.totpSecretCiphertext), input.totpCode);
      if (counter === null) throw new ApiError("INVALID_CREDENTIALS", "动态验证码错误", 401);
      const claimed = await getPrisma().pilot.updateMany({
        where: {
          id: pilot.id,
          OR: [{ lastTotpCounter: null }, { lastTotpCounter: { lt: BigInt(counter) } }],
        },
        data: {
          lastTotpCounter: BigInt(counter),
          totpVerifiedAt: pilot.totpVerifiedAt ?? new Date(),
        },
      });
      if (claimed.count !== 1) throw new ApiError("INVALID_CREDENTIALS", "动态验证码已使用", 401);
    }
    if (policy.memberFido2Required || policy.memberLoginMode === "PASSWORD_FIDO2") {
      if (!input.fidoResponse || typeof input.fidoResponse !== "object") {
        throw new ApiError("FIDO2_REQUIRED", "此认证配置需要 FIDO2 硬件验证器", 401);
      }
      await verifyAuthentication({
        kind: "PILOT_AUTHENTICATION",
        ownerId: pilot.id,
        challengeId: input.fidoChallengeId ?? "",
        response: input.fidoResponse as never,
      });
    }
    const session = await createPilotSession(pilot.id, "AUTHENTICATED", policy);
    await getPrisma().auditEvent.create({
      data: {
        actorType: "pilot",
        pilotId: pilot.id,
        action: "pilot.login_succeeded",
        entityType: "PilotSession",
        entityId: pilot.id,
        detail: { memberLoginMode: policy.memberLoginMode },
        requestId,
      },
    });
    await setSessionCookies(
      await cookies(),
      "pilot",
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
