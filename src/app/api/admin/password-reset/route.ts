import { NextRequest } from "next/server";
import { z } from "zod";
import {
  ApiError,
  assertSameOrigin,
  getRequestId,
  jsonData,
  jsonError,
  parseJson,
} from "@/server/api";
import { authenticateAdmin, hashPassword } from "@/server/auth";
import { decryptSettingSecret, resolveTotpSecret, sha256, verifyTotp } from "@/server/crypto";
import { getPrisma } from "@/server/prisma";
import { consumeRateLimit, requestAddress } from "@/server/rate-limit";
import { getRuntimeSecurityPolicy } from "@/server/runtime-settings";

const schema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/),
  newPassword: z.string().min(12).max(256),
  currentTotpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await authenticateAdmin(request);
    const reset = await getPrisma().adminPasswordResetToken.findFirst({
      where: { adminUserId: admin.id, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { tokenCiphertext: true, expiresAt: true },
    });
    if (!reset?.tokenCiphertext) {
      throw new ApiError("PASSWORD_RESET_NOT_AVAILABLE", "当前账号没有待完成的密码恢复", 404);
    }
    return jsonData(
      {
        token: decryptSettingSecret(reset.tokenCiphertext),
        expiresAt: reset.expiresAt.toISOString(),
      },
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    if (
      !(await consumeRateLimit(
        `admin-password-reset:${requestAddress(request)}`,
        10,
        15 * 60 * 1000,
      ))
    ) {
      throw new ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试", 429);
    }
    const input = await parseJson(request, schema);
    const db = getPrisma();
    const reset = await db.adminPasswordResetToken.findUnique({
      where: { tokenHash: sha256(input.token) },
      include: {
        adminUser: {
          select: {
            id: true,
            email: true,
            displayName: true,
            active: true,
            totpSecretCiphertext: true,
            totpVerifiedAt: true,
          },
        },
      },
    });
    const policy = await getRuntimeSecurityPolicy();
    if (
      !reset ||
      reset.consumedAt ||
      reset.expiresAt <= new Date() ||
      reset.policyVersion !== policy.policyVersion ||
      !reset.adminUser.active ||
      input.newPassword.toLowerCase().includes(reset.adminUser.email.toLowerCase()) ||
      input.newPassword.toLowerCase().includes(reset.adminUser.displayName.toLowerCase())
    ) {
      throw new ApiError("INVALID_PASSWORD_RESET", "重置链接无效或已过期", 422);
    }
    const targetHasVerifiedTotp = Boolean(reset.adminUser.totpVerifiedAt);
    let totpCounter: number | null = null;
    if (targetHasVerifiedTotp) {
      totpCounter = verifyTotp(
        resolveTotpSecret(reset.adminUser.totpSecretCiphertext),
        input.currentTotpCode ?? "",
      );
      if (totpCounter === null) {
        throw new ApiError("INVALID_CREDENTIALS", "请由账号本人输入当前动态验证码", 401);
      }
    } else {
      const current = await authenticateAdmin(request).catch(() => null);
      if (!current || current.id !== reset.adminUser.id) {
        throw new ApiError(
          "RESET_REQUIRES_TARGET_SESSION",
          "请在目标管理员已登录的浏览器中完成恢复",
          401,
        );
      }
    }
    const passwordHash = await hashPassword(input.newPassword);
    await db.$transaction(async (tx) => {
      const claimed = await tx.adminPasswordResetToken.updateMany({
        where: { id: reset.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new ApiError("INVALID_PASSWORD_RESET", "重置链接无效或已过期", 422);
      }
      await tx.adminUser.update({
        where: { id: reset.adminUser.id },
        data: {
          passwordHash,
          version: { increment: 1 },
          ...(totpCounter === null ? {} : { lastTotpCounter: BigInt(totpCounter) }),
        },
      });
      await tx.adminSession.deleteMany({ where: { userId: reset.adminUser.id } });
      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          actorId: reset.adminUser.id,
          action: "admin.password_reset_completed",
          entityType: "AdminUser",
          entityId: reset.adminUser.id,
          detail: { selfService: true, requestId },
          requestId,
        },
      });
    });
    return jsonData({ completed: true }, requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
