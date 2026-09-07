import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import {
  createBackupPlan,
  createBackupTarget,
  listBackupSettings,
  runBackupNow,
  saveBackupTarget,
} from "@/server/backup-service";
import { testBackupTarget } from "@/server/backup-runner";
import { parseBackupCredentials } from "@/server/backup-credential";

const actionSchema = z.object({
  action: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
});

// Endpoint/basePath are interpolated into generated rclone config files and
// remote paths; control characters would let a saved value inject additional
// config directives or destinations.
const rcloneSafeText = (message: string) =>
  z.string().refine((value) => !/[\u0000-\u001f\u007f]/.test(value), message);

const targetSchema = z.object({
  name: z.string().trim().min(1).max(128),
  type: z.enum(["LOCAL", "SMB", "FTP", "WEBDAV", "S3"]),
  endpoint: rcloneSafeText("备份服务地址不能包含换行或控制字符")
    .transform((value) => value.trim())
    .pipe(z.string().trim().min(1).max(2048)),
  basePath: rcloneSafeText("备份路径不能包含换行或控制字符")
    .transform((value) => value.trim())
    .pipe(z.string().trim().min(1).max(1024)),
  secret: z.string().max(8192).optional(),
  encryptionEnabled: z.boolean().default(true),
  active: z.boolean().default(true),
  id: z.string().uuid().optional(),
  version: z.number().int().positive().optional(),
});

const planSchema = z.object({
  name: z.string().trim().min(1).max(128),
  source: z.enum(["GALLERY", "DATABASE"]),
  mode: z.enum(["FULL", "INCREMENTAL"]),
  targetId: z.string().uuid(),
  cron: z.string().trim().min(1).max(128),
  timezone: z.string().trim().min(1).max(64).default("Asia/Shanghai"),
  retentionCount: z.number().int().min(1).max(10_000).default(30),
  retentionDays: z.number().int().min(1).max(3_650).default(90),
  enabled: z.boolean().default(true),
});

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    return jsonData(await listBackupSettings(await getAdmin(request, "settings.read")), requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const { action, input } = await parseJson(request, actionSchema);
    const admin = await getAdmin(
      request,
      action === "restore" ? "settings.backups.restore" : "settings.backups.write",
      true,
    );
    if (action === "target.create") {
      const target = targetSchema.parse(input);
      parseBackupCredentials(target.type, target.secret);
      return jsonData(await createBackupTarget(admin, target), requestId, 201);
    }
    if (action === "plan.create")
      return jsonData(await createBackupPlan(admin, planSchema.parse(input)), requestId, 201);
    if (action === "run.now")
      return jsonData(
        await runBackupNow(admin, z.object({ planId: z.string().uuid() }).parse(input).planId),
        requestId,
        202,
      );
    if (action === "restore") {
      z.object({ runId: z.string().uuid(), confirmation: z.string() }).parse(input);
      throw new ApiError(
        "OFFLINE_RESTORE_REQUIRED",
        "恢复必须通过隔离 restore profile 执行，在线 Web 不执行 pg_restore",
        409,
      );
    }
    if (action === "target.test")
      return jsonData(
        await testBackupTarget(z.object({ targetId: z.string().uuid() }).parse(input).targetId),
        requestId,
      );
    return jsonError(new Error("Unknown backup action"), requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "settings.security.write", true);
    const { action, input } = await parseJson(request, actionSchema);
    if (action === "target.save") {
      const target = targetSchema
        .extend({ id: z.string().uuid(), version: z.number().int().positive() })
        .parse(input);
      parseBackupCredentials(target.type, target.secret);
      return jsonData(await saveBackupTarget(admin, target), requestId);
    }
    return jsonError(new Error("Unknown backup action"), requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
