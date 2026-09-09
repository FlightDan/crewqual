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
import { getAdmin } from "@/server/admin-guard";
import { isSuperAdmin } from "@/server/admin-permissions";
import { requirePermission } from "@/server/auth";
import { checkObjectStorage, probeObjectStorage } from "@/server/health";
import { getPrisma } from "@/server/prisma";
import {
  getRuntimeStorageConfig,
  resolveSetupStorage,
  setupStorageSchema,
  storageLocationChanged,
  storageSettingData,
  type SetupStorageInput,
} from "@/server/runtime-storage";

const mutationSchema = z.object({
  storage: setupStorageSchema,
  expectedVersion: z.number().int().positive().optional(),
});
const connectionTestSchema = z.union([
  setupStorageSchema,
  z.object({ mode: z.literal("current") }),
]);

async function requireStorageAdmin(request: NextRequest, mutation = false) {
  const admin = await getAdmin(request, "settings.read", mutation);
  if (!isSuperAdmin(admin)) throw new ApiError("FORBIDDEN", "仅超级管理员可以管理对象存储", 403);
  if (mutation) requirePermission(admin, "settings.security.write");
  return admin;
}

async function snapshot() {
  const db = getPrisma();
  const [setting, evidenceCount, config] = await Promise.all([
    db.objectStorageSetting.findUnique({ where: { id: "global" } }),
    db.evidenceImage.count(),
    getRuntimeStorageConfig(),
  ]);
  const status = await checkObjectStorage(config);
  const builtin = config.mode === "builtin";
  return {
    mode: builtin ? ("builtin" as const) : ("s3" as const),
    endpoint: builtin ? "" : config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: builtin ? "" : config.S3_BUCKET,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    sseKmsKeyId: config.S3_SSE_KMS_KEY_ID,
    credentialsConfigured: Boolean(config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY),
    status,
    evidenceCount,
    locationLocked: evidenceCount > 0,
    version: setting?.version ?? 1,
    lastTestAt: setting?.lastTestedAt?.toISOString() ?? null,
    lastTestMessage: setting?.lastTestMessage ?? "",
  };
}

async function probe(input: SetupStorageInput) {
  try {
    return await probeObjectStorage(resolveSetupStorage(input));
  } catch (error) {
    throw new ApiError(
      "OBJECT_STORAGE_UNAVAILABLE",
      error instanceof Error ? error.message : "对象存储连接测试失败",
      422,
    );
  }
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireStorageAdmin(request);
    return jsonData(await snapshot(), requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    await requireStorageAdmin(request, true);
    const input = await parseJson(request, connectionTestSchema);
    if (input.mode === "current") {
      try {
        return jsonData(await probeObjectStorage(await getRuntimeStorageConfig()), requestId);
      } catch (error) {
        throw new ApiError(
          "OBJECT_STORAGE_UNAVAILABLE",
          error instanceof Error ? error.message : "对象存储连接测试失败",
          422,
        );
      }
    }
    return jsonData(await probe(input), requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await requireStorageAdmin(request, true);
    const input = await parseJson(request, mutationSchema);
    const db = getPrisma();
    const [current, evidenceCount] = await Promise.all([
      getRuntimeStorageConfig(),
      db.evidenceImage.count(),
    ]);
    const next = resolveSetupStorage(input.storage);
    if (evidenceCount > 0 && storageLocationChanged(current, next)) {
      throw new ApiError(
        "OBJECT_STORAGE_LOCATION_LOCKED",
        "已有证照文件时不能更换对象存储 endpoint 或 bucket；请先完成受控迁移",
        409,
      );
    }
    await probe(input.storage);
    const data = storageSettingData(input.storage);
    const existing = await db.objectStorageSetting.findUnique({ where: { id: "global" } });
    if (existing && input.expectedVersion && existing.version !== input.expectedVersion) {
      throw new ApiError("VERSION_CONFLICT", "对象存储配置已被其他管理员修改", 409);
    }
    await db.objectStorageSetting.upsert({
      where: { id: "global" },
      update: {
        ...data,
        lastTestStatus: "connected",
        lastTestMessage: "Read/write/delete probe passed",
        lastTestedAt: new Date(),
        version: { increment: 1 },
      },
      create: {
        id: "global",
        ...data,
        lastTestStatus: "connected",
        lastTestMessage: "Read/write/delete probe passed",
        lastTestedAt: new Date(),
      },
    });
    await db.auditEvent.create({
      data: {
        actorType: "admin",
        actorId: admin.id,
        action: "settings.storage.updated",
        entityType: "ObjectStorageSetting",
        entityId: "global",
        detail: {
          section: "storage",
          summary: `更新证照对象存储为 ${input.storage.mode}`,
          evidenceCount,
        },
        requestId,
      },
    });
    return jsonData(await snapshot(), requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
