import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { isSuperAdmin } from "@/server/admin-permissions";
import { getPrisma } from "@/server/prisma";
import { resolveTotpSecret, verifyTotp } from "@/server/crypto";
import { verifyPassword } from "@/server/auth";
import { getRuntimeSecurityPolicy } from "@/server/runtime-settings";
import { getSystemUpdateSnapshot, requestSystemUpdate } from "@/server/system-updates";

export const runtime = "nodejs";

const installSchema = z.object({
  version: z.string().regex(/^v\d+\.\d+\.\d+$/),
  confirmation: z.string().min(1).max(128),
  currentPassword: z.string().max(256).optional(),
  currentTotpCode: z.string().max(32).optional(),
});

function requireSuperAdmin(admin: { roles: string[] }) {
  if (!isSuperAdmin(admin)) throw new ApiError("FORBIDDEN", "仅超级管理员可以安装系统更新", 403);
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "settings.updates.read");
    requireSuperAdmin(admin);
    return jsonData(await getSystemUpdateSnapshot(), requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const { action, input } = await parseJson(
      request,
      z.object({ action: z.enum(["check", "install"]), input: z.unknown().optional() }),
    );
    const admin = await getAdmin(request, "settings.updates.install", true);
    requireSuperAdmin(admin);
    if (action === "check") return jsonData(await getSystemUpdateSnapshot(true), requestId);

    const install = installSchema.parse(input);
    if (install.confirmation !== install.version) {
      throw new ApiError("UPDATE_CONFIRMATION_REQUIRED", "请输入完整版本号确认更新", 422);
    }
    const policy = await getRuntimeSecurityPolicy();
    const actor = await getPrisma().adminUser.findUniqueOrThrow({
      where: { id: admin.id },
      select: { passwordHash: true, totpSecretCiphertext: true },
    });
    const passwordRequired = policy.adminLoginMode !== "TOTP_ONLY";
    const totpRequired = policy.adminLoginMode !== "PASSWORD_ONLY";
    if (
      passwordRequired &&
      !(await verifyPassword(actor.passwordHash, install.currentPassword ?? ""))
    ) {
      throw new ApiError("INVALID_CREDENTIALS", "当前管理员密码验证失败", 401);
    }
    if (
      totpRequired &&
      verifyTotp(resolveTotpSecret(actor.totpSecretCiphertext), install.currentTotpCode ?? "") ===
        null
    ) {
      throw new ApiError("INVALID_CREDENTIALS", "当前动态验证码验证失败", 401);
    }
    const snapshot = await getSystemUpdateSnapshot(true);
    if (!snapshot.canInstall || snapshot.latestVersion !== install.version) {
      throw new ApiError("UPDATE_NOT_AVAILABLE", snapshot.reason ?? "该版本当前不可安装", 409);
    }
    const result = await requestSystemUpdate({
      version: install.version,
      actorId: admin.id,
      actorName: admin.displayName,
    });
    await getPrisma().auditEvent.create({
      data: {
        actorType: "admin",
        actorId: admin.id,
        action: "settings.system_update.requested",
        entityType: "SystemUpdate",
        entityId: result.job.id,
        detail: { version: install.version, jobId: result.job.id, section: "updates" },
        requestId,
      },
    });
    return jsonData(result, requestId, 202);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
