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
import { assertCsrf, type AuthenticatedAdmin } from "@/server/auth";
import { getAdmin } from "@/server/admin-guard";
import { isSuperAdmin } from "@/server/admin-permissions";
import { getPrisma } from "@/server/prisma";

const inputSchema = z.object({
  enabled: z.boolean(),
  idleMinutes: z.number().int().min(1).max(1440),
  batchSize: z.number().int().min(1).max(20),
  version: z.number().int().positive(),
});

function requireSuperAdmin(admin: AuthenticatedAdmin) {
  if (!isSuperAdmin(admin)) throw new ApiError("FORBIDDEN", "仅超级管理员可以管理图库优化", 403);
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "settings.read");
    requireSuperAdmin(admin);
    const setting = await getPrisma().mediaOptimizationSetting.upsert({
      where: { id: "global" },
      update: {},
      create: { id: "global" },
    });
    return jsonData(setting, requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "settings.security.write", true);
    requireSuperAdmin(admin);
    await assertCsrf(request, admin.csrfToken);
    const input = await parseJson(request, inputSchema);
    const updated = await getPrisma().mediaOptimizationSetting.updateMany({
      where: { id: "global", version: input.version },
      data: {
        enabled: input.enabled,
        idleMinutes: input.idleMinutes,
        batchSize: input.batchSize,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new ApiError("VERSION_CONFLICT", "图库优化设置已被更新", 409);
    return jsonData(
      await getPrisma().mediaOptimizationSetting.findUniqueOrThrow({ where: { id: "global" } }),
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId);
  }
}
