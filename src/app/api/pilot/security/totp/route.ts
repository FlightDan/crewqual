import { NextRequest } from "next/server";
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
  assertCsrf,
  authenticatePilot,
  refreshPilotEnrollment,
  verifyPassword,
} from "@/server/auth";
import {
  createTotpSecret,
  encryptSettingSecret,
  resolveTotpSecret,
  verifyTotp,
} from "@/server/crypto";
import { getPrisma } from "@/server/prisma";
import { getRuntimeSecurityPolicy } from "@/server/runtime-settings";
import { verifyAuthentication } from "@/server/webauthn";

const schema = z.object({
  secret: z
    .string()
    .regex(/^[A-Z2-7]{20,}$/)
    .optional(),
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  currentCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  currentPassword: z.string().max(256).optional(),
  currentFidoChallengeId: z.string().uuid().optional(),
  currentFidoResponse: z.unknown().optional(),
});

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const pilot = await authenticatePilot(request, { allowPending: true });
    await assertCsrf(request, pilot.csrfToken);
    const input = await parseJson(request, schema);
    const policy = await getRuntimeSecurityPolicy();
    const record = await getPrisma().pilot.findUniqueOrThrow({ where: { id: pilot.id } });
    const existingFido = await getPrisma().fidoCredential.count({ where: { pilotId: pilot.id } });
    if (
      pilot.authState !== "AUTHENTICATED" &&
      (record.passwordHash || record.totpSecretCiphertext || existingFido)
    ) {
      throw new ApiError(
        "ENROLLMENT_REQUIRES_CURRENT_FACTORS",
        "已有认证因素的账号不能通过短信会话重新绑定动态密码",
        401,
      );
    }
    if (record.totpSecretCiphertext) {
      if (
        !input.currentCode ||
        verifyTotp(resolveTotpSecret(record.totpSecretCiphertext), input.currentCode) === null
      ) {
        throw new ApiError("INVALID_CREDENTIALS", "当前动态验证码错误", 401);
      }
    } else if (
      record.passwordHash &&
      (!input.currentPassword ||
        !(await verifyPassword(record.passwordHash, input.currentPassword)))
    ) {
      throw new ApiError("INVALID_CREDENTIALS", "当前密码错误", 401);
    }
    if (
      pilot.authState === "AUTHENTICATED" &&
      (policy.memberFido2Required || policy.memberLoginMode === "PASSWORD_FIDO2")
    ) {
      if (!input.currentFidoChallengeId || !input.currentFidoResponse) {
        throw new ApiError("FIDO2_REQUIRED", "当前安全策略需要硬件验证器再次确认", 401);
      }
      await verifyAuthentication({
        kind: "PILOT_AUTHENTICATION",
        ownerId: pilot.id,
        challengeId: input.currentFidoChallengeId,
        sessionId: pilot.sessionId,
        response: input.currentFidoResponse as never,
      });
    }
    const secret = input.secret ?? createTotpSecret(20);
    if (!input.secret) {
      return jsonData(
        {
          secret,
          uri: `otpauth://totp/CrewQual:${encodeURIComponent(pilot.employeeNumber)}?secret=${secret}&issuer=CrewQual`,
        },
        requestId,
      );
    }
    if (!input.code || verifyTotp(secret, input.code) === null) {
      throw new ApiError("INVALID_TOTP", "动态验证码错误", 422);
    }
    await getPrisma().pilot.update({
      where: { id: pilot.id },
      data: {
        totpSecretCiphertext: encryptSettingSecret(secret),
        totpVerifiedAt: new Date(),
        lastTotpCounter: null,
      },
    });
    const authenticated = await refreshPilotEnrollment(pilot.sessionId, pilot.id);
    await getPrisma().auditEvent.create({
      data: {
        actorType: "pilot",
        pilotId: pilot.id,
        action: "pilot.totp_bound",
        entityType: "Pilot",
        entityId: pilot.id,
        detail: {},
        requestId,
      },
    });
    return jsonData({ verified: true, authenticated }, requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
