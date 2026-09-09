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
  hashPassword,
  refreshPilotEnrollment,
  verifyPassword,
} from "@/server/auth";
import { resolveTotpSecret, verifyTotp } from "@/server/crypto";
import { getPrisma } from "@/server/prisma";
import { getRuntimeSecurityPolicy } from "@/server/runtime-settings";
import { verifyAuthentication } from "@/server/webauthn";

const schema = z.object({
  currentPassword: z.string().max(256).optional(),
  currentTotpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  currentFidoChallengeId: z.string().uuid().optional(),
  currentFidoResponse: z.unknown().optional(),
  newPassword: z.string().min(12).max(256),
});

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const pilot = await authenticatePilot(request, { allowPending: true });
    await assertCsrf(request, pilot.csrfToken);
    const input = await parseJson(request, schema);
    const db = getPrisma();
    const record = await db.pilot.findUniqueOrThrow({ where: { id: pilot.id } });
    const policy = await getRuntimeSecurityPolicy();
    const existingFido = await db.fidoCredential.count({ where: { pilotId: pilot.id } });
    if (
      pilot.authState !== "AUTHENTICATED" &&
      (record.passwordHash || record.totpSecretCiphertext || existingFido)
    ) {
      throw new ApiError(
        "ENROLLMENT_REQUIRES_CURRENT_FACTORS",
        "已有认证因素的账号不能通过短信会话恢复密码，请使用完整认证登录",
        401,
      );
    }
    if (record.passwordHash) {
      if (
        !input.currentPassword ||
        !(await verifyPassword(record.passwordHash, input.currentPassword))
      ) {
        throw new ApiError("INVALID_CREDENTIALS", "当前密码错误", 401);
      }
    }
    if (pilot.authState === "AUTHENTICATED" && policy.memberLoginMode === "PASSWORD_TOTP") {
      if (
        !record.totpSecretCiphertext ||
        verifyTotp(resolveTotpSecret(record.totpSecretCiphertext), input.currentTotpCode ?? "") ===
          null
      ) {
        throw new ApiError("INVALID_CREDENTIALS", "当前动态验证码错误", 401);
      }
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
    if (
      input.newPassword.toLowerCase().includes(record.employeeNumber.toLowerCase()) ||
      input.newPassword.toLowerCase().includes(record.displayName.toLowerCase())
    ) {
      throw new ApiError("WEAK_PASSWORD", "密码不能包含工号或姓名", 422);
    }
    await db.pilot.update({
      where: { id: pilot.id },
      data: { passwordHash: await hashPassword(input.newPassword), passwordSetAt: new Date() },
    });
    const authenticated = await refreshPilotEnrollment(pilot.sessionId, pilot.id);
    await db.auditEvent.create({
      data: {
        actorType: "pilot",
        pilotId: pilot.id,
        action: "pilot.password_changed",
        entityType: "Pilot",
        entityId: pilot.id,
        detail: { selfService: true },
        requestId,
      },
    });
    await db.pilotSession.deleteMany({
      where: { pilotId: pilot.id, id: { not: pilot.sessionId } },
    });
    return jsonData({ changed: true, authenticated }, requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
