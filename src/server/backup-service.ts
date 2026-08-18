import { getPrisma } from "@/server/prisma";
import { encryptSettingSecret } from "@/server/crypto";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiError } from "@/server/api";
import type { AuthenticatedAdmin } from "@/server/auth";
import { isSuperAdmin } from "@/server/admin-permissions";

export const BACKUP_TARGET_TYPES = ["LOCAL", "SMB", "FTP", "WEBDAV", "S3"] as const;
export const BACKUP_SOURCES = ["GALLERY", "DATABASE"] as const;
export const BACKUP_MODES = ["FULL", "INCREMENTAL"] as const;

function requireBackupAdmin(admin: AuthenticatedAdmin) {
  if (!isSuperAdmin(admin)) throw new ApiError("FORBIDDEN", "仅超级管理员可以管理备份", 403);
}

function mapTarget(target: any) {
  return {
    id: target.id,
    name: target.name,
    type: target.type,
    endpoint: target.endpoint,
    basePath: target.basePath,
    encryptionEnabled: target.encryptionEnabled,
    active: target.active,
    secretConfigured: Boolean(target.secretCiphertext),
    lastTestedAt: target.lastTestedAt?.toISOString() ?? null,
    lastTestMessage: target.lastTestMessage,
    version: target.version,
  };
}

function mapPlan(plan: any) {
  return {
    id: plan.id,
    name: plan.name,
    source: plan.source,
    mode: plan.mode,
    cron: plan.cron,
    timezone: plan.timezone,
    retentionCount: plan.retentionCount,
    retentionDays: plan.retentionDays,
    enabled: plan.enabled,
    version: plan.version,
    targetId: plan.targetId,
    targetName: plan.target?.name ?? "",
    lastSuccessfulAt: plan.lastSuccessfulAt?.toISOString() ?? null,
  };
}

export async function listBackupSettings(admin: AuthenticatedAdmin) {
  requireBackupAdmin(admin);
  const db = getPrisma();
  const [targets, plans, runs] = await Promise.all([
    db.backupTarget.findMany({ orderBy: { createdAt: "asc" } }),
    db.backupPlan.findMany({ include: { target: true }, orderBy: { createdAt: "asc" } }),
    db.backupRun.findMany({
      include: { plan: { select: { name: true, source: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return {
    targets: targets.map(mapTarget),
    plans: plans.map(mapPlan),
    runs: runs.map((run) => ({
      id: run.id,
      planId: run.planId,
      planName: run.plan.name,
      source: run.plan.source,
      mode: run.mode,
      status: run.status,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      bytesWritten: Number(run.bytesWritten),
      artifactPath: run.artifactPath,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt.toISOString(),
    })),
  };
}

export async function createBackupTarget(admin: AuthenticatedAdmin, input: any) {
  requireBackupAdmin(admin);
  if (input.type === "LOCAL" && process.env.NODE_ENV === "production") {
    throw new ApiError("LOCAL_BACKUP_DISABLED", "生产正式备份必须使用远端 S3 目标", 422);
  }
  if (input.type === "LOCAL" && !input.endpoint.startsWith("/backups")) {
    throw new ApiError(
      "INVALID_LOCAL_BACKUP_PATH",
      "本地备份只能写入 Worker 的 /backups staging 卷",
      422,
    );
  }
  if (input.type === "S3") {
    let endpoint: URL;
    try {
      endpoint = new URL(input.endpoint);
    } catch {
      throw new ApiError("INVALID_BACKUP_ENDPOINT", "S3 目标地址无效", 422);
    }
    if (endpoint.protocol !== "https:" && process.env.NODE_ENV === "production") {
      throw new ApiError("INSECURE_BACKUP_ENDPOINT", "生产 S3 目标必须使用 HTTPS", 422);
    }
  }
  const secret = typeof input.secret === "string" ? input.secret : "";
  const target = await getPrisma().backupTarget.create({
    data: {
      name: input.name,
      type: input.type,
      endpoint: input.endpoint,
      basePath: input.basePath,
      encryptionEnabled: input.encryptionEnabled ?? true,
      secretCiphertext: secret ? encryptSettingSecret(secret) : null,
    },
  });
  return mapTarget(target);
}

export async function saveBackupTarget(admin: AuthenticatedAdmin, input: any) {
  requireBackupAdmin(admin);
  if (input.type === "LOCAL" && process.env.NODE_ENV === "production") {
    throw new ApiError("LOCAL_BACKUP_DISABLED", "生产正式备份必须使用远端 S3 目标", 422);
  }
  if (input.type === "LOCAL" && !String(input.endpoint).startsWith("/backups")) {
    throw new ApiError(
      "INVALID_LOCAL_BACKUP_PATH",
      "本地备份只能写入 Worker 的 /backups staging 卷",
      422,
    );
  }
  const current = await getPrisma().backupTarget.findUnique({ where: { id: input.id } });
  if (!current) throw new ApiError("BACKUP_TARGET_NOT_FOUND", "备份目标不存在", 404);
  const updated = await getPrisma().backupTarget.updateMany({
    where: { id: input.id, version: input.version },
    data: {
      name: input.name,
      endpoint: input.endpoint,
      basePath: input.basePath,
      active: input.active,
      encryptionEnabled: input.encryptionEnabled,
      ...(input.secret ? { secretCiphertext: encryptSettingSecret(input.secret) } : {}),
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw new ApiError("VERSION_CONFLICT", "备份目标已被更新", 409);
  return mapTarget(await getPrisma().backupTarget.findUniqueOrThrow({ where: { id: input.id } }));
}

export async function createBackupPlan(admin: AuthenticatedAdmin, input: any) {
  requireBackupAdmin(admin);
  if (input.source === "DATABASE" && input.mode !== "FULL") {
    throw new ApiError("INVALID_BACKUP_MODE", "数据库目前只支持全量备份", 422);
  }
  const target = await getPrisma().backupTarget.findUnique({ where: { id: input.targetId } });
  if (!target || !target.active)
    throw new ApiError("BACKUP_TARGET_NOT_FOUND", "备份目标不存在或已停用", 422);
  return mapPlan(
    await getPrisma().backupPlan.create({
      data: {
        name: input.name,
        source: input.source,
        mode: input.mode,
        targetId: input.targetId,
        cron: input.cron,
        timezone: input.timezone || "Asia/Shanghai",
        retentionCount: input.retentionCount,
        retentionDays: input.retentionDays,
        enabled: input.enabled,
      },
      include: { target: true },
    }),
  );
}

export async function runBackupNow(admin: AuthenticatedAdmin, planId: string) {
  requireBackupAdmin(admin);
  const plan = await getPrisma().backupPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new ApiError("BACKUP_PLAN_NOT_FOUND", "备份计划不存在", 404);
  const run = await getPrisma().backupRun.create({ data: { planId, mode: plan.mode } });
  return { id: run.id, status: run.status };
}
