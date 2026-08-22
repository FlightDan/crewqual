import { randomUUID } from "node:crypto";
import { z } from "zod";
import packageJson from "../../package.json";
import { Prisma } from "@/generated/prisma/client";
import { ApiError } from "@/server/api";
import { ADMIN_PERMISSION_CODES } from "@/server/admin-permissions";
import { hashPassword } from "@/server/auth";
import { getServerConfig } from "@/server/config";
import {
  createOpaqueToken,
  createTotpSecret,
  decryptSettingSecret,
  encryptSettingSecret,
  verifyTotp,
} from "@/server/crypto";
import { checkObjectStorage } from "@/server/health";
import { probeObjectStorage } from "@/server/health";
import { getPrisma } from "@/server/prisma";
import { normalizeLocalBackupLocation } from "@/server/backup-path";
import {
  resolveSetupStorage,
  setupStorageSchema,
  storageSettingData,
} from "@/server/runtime-storage";
import { installTemplatePackInTransaction, parseTemplatePack } from "@/server/template-packs";
import type {
  SetupCompleteInput,
  SetupCompleteResult,
  SetupEnvironmentStatus,
  SetupLocale,
  SetupOverview,
  SetupTemplate,
} from "@/types/setup";

const setupLocaleSchema = z.enum(["zh-CN", "en-US"]);

function isValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const externalChannelSchema = z.object({
  enabled: z.boolean(),
  endpoint: z.union([z.string().url(), z.literal("")]),
  secret: z.string().max(8192).optional(),
});

export const setupCompleteSchema = z
  .object({
    locale: setupLocaleSchema,
    timezone: z.string().trim().min(1).max(64).refine(isValidTimezone, "时区无效"),
    organizationName: z.string().trim().max(128),
    storage: setupStorageSchema,
    admin: z.object({
      displayName: z.string().trim().min(1).max(128),
      email: z
        .string()
        .trim()
        .email()
        .transform((value) => value.toLowerCase()),
      password: z.string().min(12).max(256),
      requireTotp: z.boolean(),
      verifiedTotpToken: z.string().max(4096).optional(),
    }),
    templatePackIds: z.array(z.string().uuid()).max(20),
    backup: z.object({
      enabled: z.boolean(),
      targetName: z.string().trim().min(1).max(128),
      targetType: z.enum(["LOCAL", "SMB", "FTP", "WEBDAV", "S3"]),
      endpoint: z.string().trim().max(2048),
      basePath: z.string().trim().min(1).max(1024),
      secret: z.string().max(8192).optional(),
    }),
    notifications: z.object({
      inApp: z.boolean(),
      feishu: externalChannelSchema,
      sms: externalChannelSchema,
      routes: z
        .array(
          z.object({
            key: z.enum([
              "qualification_expiry",
              "review_approved",
              "review_returned",
              "upgrade_created",
              "upgrade_rescheduled",
              "upgrade_completed",
              "delivery_failed",
            ]),
            channels: z.array(z.enum(["inApp", "feishu", "sms"])).min(1),
          }),
        )
        .max(7)
        .optional(),
    }),
  })
  .superRefine((value, context) => {
    if (value.admin.requireTotp && !value.admin.verifiedTotpToken) {
      context.addIssue({
        code: "custom",
        path: ["admin", "verifiedTotpToken"],
        message: "请先完成双重验证",
      });
    }
    if (value.backup.enabled && !value.backup.endpoint) {
      context.addIssue({
        code: "custom",
        path: ["backup", "endpoint"],
        message: "请填写备份目标",
      });
    }
    if (value.backup.enabled && value.backup.targetType === "LOCAL") {
      try {
        normalizeLocalBackupLocation(value.backup.endpoint, value.backup.basePath);
      } catch (error) {
        context.addIssue({
          code: "custom",
          path: ["backup", "endpoint"],
          message: error instanceof Error ? error.message : "本地备份路径无效",
        });
      }
    }
    if (
      value.backup.enabled &&
      value.backup.targetType !== "LOCAL" &&
      !value.backup.secret?.trim()
    ) {
      context.addIssue({
        code: "custom",
        path: ["backup", "secret"],
        message: "远端备份目标需要账号与密钥 JSON",
      });
    }
    for (const key of ["feishu", "sms"] as const) {
      if (value.notifications[key].enabled && !value.notifications[key].endpoint) {
        context.addIssue({
          code: "custom",
          path: ["notifications", key, "endpoint"],
          message: "启用外部渠道前请填写服务地址",
        });
      }
    }
    if (value.notifications.routes) {
      const enabledChannels = new Set([
        ...(value.notifications.inApp ? ["inApp"] : []),
        ...(value.notifications.feishu.enabled ? ["feishu"] : []),
        ...(value.notifications.sms.enabled ? ["sms"] : []),
      ]);
      for (const [index, route] of value.notifications.routes.entries()) {
        if (route.channels.some((channel) => !enabledChannels.has(channel))) {
          context.addIssue({
            code: "custom",
            path: ["notifications", "routes", index, "channels"],
            message: "路由规则包含未启用的通知渠道",
          });
        }
      }
    }
  });

type EnrollmentPayload = {
  kind: "setup-totp-enrollment";
  email: string;
  secret: string;
  expiresAt: number;
};

type VerifiedPayload = {
  kind: "setup-totp-verified";
  email: string;
  secret: string;
  verifiedAt: number;
  expiresAt: number;
};

const enrollmentPayloadSchema = z.object({
  kind: z.literal("setup-totp-enrollment"),
  email: z.string().email(),
  secret: z.string().regex(/^[A-Z2-7]{16,}$/),
  expiresAt: z.number().int().positive(),
});

const verifiedPayloadSchema = z.object({
  kind: z.literal("setup-totp-verified"),
  email: z.string().email(),
  secret: z.string().regex(/^[A-Z2-7]{16,}$/),
  verifiedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
});

function provisioningUri(email: string, secret: string) {
  const label = encodeURIComponent(`CrewQual:${email}`);
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=CrewQual`;
}

function decodeSetupToken<T>(token: string, schema: z.ZodType<T>): T {
  try {
    const payload = schema.parse(JSON.parse(decryptSettingSecret(token)));
    if ((payload as { expiresAt: number }).expiresAt < Date.now()) {
      throw new ApiError("SETUP_TOKEN_EXPIRED", "验证信息已过期，请重新生成", 422);
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_SETUP_TOKEN", "验证信息无效，请重新生成", 422);
  }
}

function setupToken(payload: EnrollmentPayload | VerifiedPayload) {
  return encryptSettingSecret(JSON.stringify(payload));
}

function translatedRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function mapTemplate(row: {
  id: string;
  code: string;
  version: number;
  name: string;
  description: string;
  translations: unknown;
  payload: unknown;
}): SetupTemplate | null {
  try {
    const pack = parseTemplatePack(row.payload);
    return {
      id: row.id,
      code: row.code,
      version: row.version,
      name: row.name,
      description: row.description,
      translations: translatedRecord(row.translations),
      descriptionTranslations: pack.descriptionTranslations,
      positionCount: pack.positions.length,
      qualificationCount: pack.qualificationDefinitions.length,
    };
  } catch {
    return null;
  }
}

const mockTemplates: SetupTemplate[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    code: "aviation-pilot",
    version: 2,
    name: "飞行员",
    description: "包含机长、副驾驶等岗位，以及执照、体检和型别等级等基础合规要求。",
    translations: { "en-US": "Flight crew" },
    descriptionTranslations: {
      "en-US": "Core qualifications for captains, first officers, and flight crew compliance.",
    },
    positionCount: 2,
    qualificationCount: 12,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    code: "aviation-cabin-crew",
    version: 2,
    name: "乘务员",
    description: "客舱乘务员、乘务长，以及客舱应急训练和联合演练要求。",
    translations: { "en-US": "Cabin crew" },
    descriptionTranslations: { "en-US": "Cabin crew roles, emergency training, and joint drills." },
    positionCount: 2,
    qualificationCount: 8,
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    code: "aviation-dispatcher",
    version: 1,
    name: "签派员",
    description: "运行控制与飞行签派人员，涵盖执照、行业训练与专项研讨。",
    translations: { "en-US": "Flight dispatcher" },
    descriptionTranslations: {
      "en-US": "Flight dispatch licensing, recurrent training, and workshops.",
    },
    positionCount: 1,
    qualificationCount: 6,
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    code: "aviation-maintenance",
    version: 2,
    name: "机务人员",
    description: "航空维修工程师，涵盖机型放行签署、岗位执照及安全规范。",
    translations: { "en-US": "Maintenance crew" },
    descriptionTranslations: {
      "en-US": "Aircraft maintenance licensing, release authority, and safety standards.",
    },
    positionCount: 1,
    qualificationCount: 10,
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    code: "aviation-safety",
    version: 1,
    name: "安全监察员",
    description: "安全管理与审核人员，包含 SMS 安全管理与审计员认证模板。",
    translations: { "en-US": "Safety inspector" },
    descriptionTranslations: {
      "en-US": "Safety management, SMS controls, and auditor certification templates.",
    },
    positionCount: 1,
    qualificationCount: 5,
  },
];

export function mockSetupOverview(): SetupOverview {
  return {
    required: true,
    mode: "mock",
    environment: {
      database: "ok",
      storage: "ok",
      worker: "warning",
      workerDetail: "1 Worker online",
      version: packageJson.version,
    },
    templates: mockTemplates,
    defaults: {
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      organizationName: "",
      backupPath: "/backups/crewqual",
    },
  };
}

function healthStatus(value: "ok" | "unconfigured" | "unavailable"): SetupEnvironmentStatus {
  return value === "ok" ? "ok" : value === "unconfigured" ? "warning" : "error";
}

export async function isSetupRequired() {
  const config = getServerConfig();
  if (config.SERVICE_MODE === "mock") return false;
  const count = await getPrisma().adminUser.count({
    where: {
      active: true,
      roles: { some: { role: { code: "SUPER_ADMIN" } } },
    },
  });
  return count === 0;
}

export async function getSetupOverview(): Promise<SetupOverview> {
  const config = getServerConfig();
  if (config.SERVICE_MODE === "mock") return mockSetupOverview();
  const db = getPrisma();
  const [databaseProbe, storageProbe] = await Promise.allSettled([
    Promise.all([
      db.$queryRaw`SELECT 1`,
      db.adminUser.count({
        where: {
          active: true,
          roles: { some: { role: { code: "SUPER_ADMIN" } } },
        },
      }),
      db.workerHeartbeat.findMany(),
      db.templatePack.findMany({
        where: { active: true },
        orderBy: [{ name: "asc" }, { version: "desc" }],
      }),
      db.organization.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } }),
    ]),
    checkObjectStorage(),
  ]);

  if (databaseProbe.status === "rejected") {
    return {
      required: true,
      mode: "remote",
      environment: {
        database: "error",
        storage: storageProbe.status === "fulfilled" ? healthStatus(storageProbe.value) : "unknown",
        worker: "unknown",
        workerDetail: "Worker status unavailable",
        version: packageJson.version,
      },
      templates: [],
      defaults: {
        locale: "zh-CN",
        timezone: "Asia/Shanghai",
        organizationName: "",
        backupPath: "/backups/crewqual",
      },
    };
  }

  const [, activeSuperAdmins, heartbeats, rows, organization] = databaseProbe.value;
  const onlineWorkers = heartbeats.filter(
    (heartbeat) => Date.now() - heartbeat.lastSeenAt.getTime() <= 45_000,
  );
  const templates = rows.map(mapTemplate).filter((item): item is SetupTemplate => Boolean(item));
  return {
    required: activeSuperAdmins === 0,
    mode: "remote",
    environment: {
      database: "ok",
      storage: storageProbe.status === "fulfilled" ? healthStatus(storageProbe.value) : "error",
      worker: onlineWorkers.length ? "ok" : "warning",
      workerDetail: onlineWorkers.length
        ? `${onlineWorkers.length} Worker online`
        : "No online Worker detected",
      version: packageJson.version,
    },
    templates,
    defaults: {
      locale: (organization?.defaultLocale === "en-US" ? "en-US" : "zh-CN") as SetupLocale,
      timezone: "Asia/Shanghai",
      organizationName: organization?.name ?? "",
      backupPath: "/backups/crewqual",
    },
  };
}

export async function assertSetupOpen() {
  if (!(await isSetupRequired())) {
    throw new ApiError("SETUP_ALREADY_COMPLETED", "系统初始化已经完成", 409);
  }
}

export async function provisionSetupTotp(emailInput: string) {
  await assertSetupOpen();
  const email = z.string().trim().email().parse(emailInput).toLowerCase();
  const secret = createTotpSecret();
  const expiresAt = Date.now() + 15 * 60 * 1000;
  return {
    secret,
    uri: provisioningUri(email, secret),
    enrollmentToken: setupToken({
      kind: "setup-totp-enrollment",
      email,
      secret,
      expiresAt,
    }),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export async function verifySetupTotp(input: {
  email: string;
  code: string;
  enrollmentToken: string;
}) {
  await assertSetupOpen();
  const email = z.string().trim().email().parse(input.email).toLowerCase();
  const code = z
    .string()
    .regex(/^\d{6}$/)
    .parse(input.code);
  const enrollment = decodeSetupToken(input.enrollmentToken, enrollmentPayloadSchema);
  if (enrollment.email !== email || verifyTotp(enrollment.secret, code) === null) {
    throw new ApiError("INVALID_TOTP", "动态验证码无效，请检查验证器时间后重试", 422);
  }
  const verifiedAt = Date.now();
  const expiresAt = verifiedAt + 20 * 60 * 1000;
  return {
    verifiedToken: setupToken({
      kind: "setup-totp-verified",
      email,
      secret: enrollment.secret,
      verifiedAt,
      expiresAt,
    }),
    verifiedAt: new Date(verifiedAt).toISOString(),
  };
}

export function validateSetupBackupTarget(input: {
  type: "LOCAL" | "SMB" | "FTP" | "WEBDAV" | "S3";
  endpoint: string;
  basePath: string;
}) {
  const endpoint = input.endpoint.trim();
  const basePath = input.basePath.trim();
  if (!endpoint || !basePath) {
    throw new ApiError("BACKUP_TARGET_INVALID", "请填写完整的备份目标", 422);
  }
  const localLocation =
    input.type === "LOCAL" ? normalizeLocalBackupLocation(endpoint, basePath) : null;
  if (input.type === "S3") {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new ApiError("INVALID_BACKUP_ENDPOINT", "S3 服务地址无效", 422);
    }
    if (getServerConfig().NODE_ENV === "production" && url.protocol !== "https:") {
      throw new ApiError("INSECURE_BACKUP_ENDPOINT", "生产环境的 S3 地址必须使用 HTTPS", 422);
    }
  }
  return {
    ok: true as const,
    message:
      input.type === "LOCAL"
        ? "目录格式有效；初始化后将由 Worker 验证实际写入权限"
        : "目标格式有效；初始化后可在系统设置中执行连接测试",
    ...(localLocation ?? {}),
  };
}

const notificationRoutes = [
  "qualification_expiry",
  "review_approved",
  "review_returned",
  "upgrade_created",
  "upgrade_rescheduled",
  "upgrade_completed",
  "delivery_failed",
] as const;

function channelRouting(input: SetupCompleteInput["notifications"]) {
  const channels = [
    ...(input.inApp ? ["inApp"] : []),
    ...(input.feishu.enabled ? ["feishu"] : []),
    ...(input.sms.enabled ? ["sms"] : []),
  ];
  const configured = new Map(input.routes?.map((route) => [route.key, route.channels]));
  return notificationRoutes.map((key) => ({ key, channels: configured.get(key) ?? channels }));
}

function organizationCode() {
  return `ORG-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function unitCode() {
  return `UNIT-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function completeSetup(rawInput: SetupCompleteInput): Promise<SetupCompleteResult> {
  const input = setupCompleteSchema.parse(rawInput);
  const storageConfig = resolveSetupStorage(input.storage);
  try {
    await probeObjectStorage(storageConfig);
  } catch (error) {
    throw new ApiError(
      "OBJECT_STORAGE_UNAVAILABLE",
      error instanceof Error ? error.message : "对象存储连接测试失败",
      422,
    );
  }
  const storageData = storageSettingData(input.storage);
  let verifiedTotp: VerifiedPayload | null = null;
  if (input.admin.requireTotp) {
    verifiedTotp = decodeSetupToken(input.admin.verifiedTotpToken ?? "", verifiedPayloadSchema);
    if (verifiedTotp.email !== input.admin.email) {
      throw new ApiError("INVALID_SETUP_TOKEN", "双重验证信息与管理员邮箱不匹配", 422);
    }
  }
  if (input.backup.enabled) {
    const backupLocation = validateSetupBackupTarget({
      type: input.backup.targetType,
      endpoint: input.backup.endpoint,
      basePath: input.backup.basePath,
    });
    input.backup.endpoint = backupLocation.endpoint ?? input.backup.endpoint;
    input.backup.basePath = backupLocation.basePath ?? input.backup.basePath;
  }
  const passwordHash = await hashPassword(input.admin.password);
  const totpSecret = verifiedTotp?.secret ?? createTotpSecret();
  const db = getPrisma();

  return db.$transaction(
    async (tx) => {
      if (typeof tx.$executeRawUnsafe === "function") {
        await tx.$executeRawUnsafe('LOCK TABLE "AdminUser" IN SHARE ROW EXCLUSIVE MODE');
      }
      const activeSuperAdmins = await tx.adminUser.count({
        where: {
          active: true,
          roles: { some: { role: { code: "SUPER_ADMIN" } } },
        },
      });
      if (activeSuperAdmins > 0) {
        throw new ApiError("SETUP_ALREADY_COMPLETED", "系统初始化已经完成", 409);
      }
      const role = await tx.role.findUnique({ where: { code: "SUPER_ADMIN" } });
      if (!role) {
        throw new ApiError("SETUP_BASELINE_MISSING", "系统角色尚未初始化，请先运行数据库引导", 503);
      }
      const permissionCount = await tx.permission.count({
        where: { code: { in: [...ADMIN_PERMISSION_CODES] } },
      });
      if (permissionCount !== ADMIN_PERMISSION_CODES.length) {
        throw new ApiError("SETUP_BASELINE_MISSING", "系统权限基线不完整，请先运行数据库迁移", 503);
      }

      const organizationName = input.organizationName || "CrewQual Organization";
      const existingOrganization = await tx.organization.findFirst({
        where: { active: true },
        orderBy: { createdAt: "asc" },
      });
      const organization = existingOrganization
        ? await tx.organization.update({
            where: { id: existingOrganization.id },
            data: {
              name: organizationName,
              defaultLocale: input.locale,
              version: { increment: 1 },
            },
          })
        : await tx.organization.create({
            data: {
              code: organizationCode(),
              name: organizationName,
              defaultLocale: input.locale,
            },
          });
      const existingUnit = await tx.organizationUnit.findFirst({
        where: { organizationId: organization.id, active: true },
        orderBy: { createdAt: "asc" },
      });
      const unit = existingUnit
        ? await tx.organizationUnit.update({
            where: { id: existingUnit.id },
            data: {
              name: organizationName,
              timezone: input.timezone,
              version: { increment: 1 },
            },
          })
        : await tx.organizationUnit.create({
            data: {
              code: unitCode(),
              name: organizationName,
              timezone: input.timezone,
              organizationId: organization.id,
            },
          });

      const admin = await tx.adminUser.create({
        data: {
          email: input.admin.email,
          displayName: input.admin.displayName,
          passwordHash,
          totpSecretCiphertext: encryptSettingSecret(totpSecret),
          totpVerifiedAt: input.admin.requireTotp ? new Date(verifiedTotp!.verifiedAt) : null,
          organizationId: organization.id,
          roles: { create: { roleId: role.id } },
        },
      });

      await tx.securityPolicy.upsert({
        where: { id: "global" },
        update: {
          adminLoginMode: input.admin.requireTotp ? "PASSWORD_TOTP" : "PASSWORD_ONLY",
          allowPublicAccess: getServerConfig().DEPLOYMENT_NETWORK_MODE === "tls",
          version: { increment: 1 },
        },
        create: {
          id: "global",
          adminLoginMode: input.admin.requireTotp ? "PASSWORD_TOTP" : "PASSWORD_ONLY",
          allowPublicAccess: getServerConfig().DEPLOYMENT_NETWORK_MODE === "tls",
        },
      });

      await tx.objectStorageSetting.upsert({
        where: { id: "global" },
        update: {
          ...storageData,
          lastTestStatus: "connected",
          lastTestMessage: "Setup read/write/delete probe passed",
          lastTestedAt: new Date(),
          version: { increment: 1 },
        },
        create: {
          id: "global",
          ...storageData,
          lastTestStatus: "connected",
          lastTestMessage: "Setup read/write/delete probe passed",
          lastTestedAt: new Date(),
        },
      });

      let installedPositionCount = 0;
      for (const templatePackId of [...new Set(input.templatePackIds)]) {
        const installed = await installTemplatePackInTransaction(
          tx,
          organization.id,
          templatePackId,
          admin.id,
        );
        installedPositionCount += installed.createdPositions;
      }

      const routes = channelRouting(input.notifications);
      if (!routes.every((route) => route.channels.length)) {
        throw new ApiError("NOTIFICATION_ROUTE_EMPTY", "每类事件至少需要一个通知渠道", 422);
      }
      await tx.organizationUnit.update({
        where: { id: unit.id },
        data: {
          notificationChannelState: {
            inApp: input.notifications.inApp,
            feishu: input.notifications.feishu.enabled,
            sms: input.notifications.sms.enabled,
          },
          notificationRouting: routes,
          version: { increment: 1 },
        },
      });

      for (const key of ["feishu", "sms"] as const) {
        const channel = input.notifications[key];
        await tx.systemIntegrationSetting.upsert({
          where: { key },
          update: {
            enabled: channel.enabled,
            endpoint: channel.endpoint,
            ...(channel.secret ? { secretCiphertext: encryptSettingSecret(channel.secret) } : {}),
            version: { increment: 1 },
          },
          create: {
            key,
            enabled: channel.enabled,
            endpoint: channel.endpoint,
            secretCiphertext: channel.secret ? encryptSettingSecret(channel.secret) : null,
            retryLimit: 3,
          },
        });
      }

      if (input.backup.enabled) {
        const generatedSecret =
          input.backup.secret ||
          (input.backup.targetType === "LOCAL"
            ? createOpaqueToken(32)
            : JSON.stringify({ encryptionKey: createOpaqueToken(32) }));
        const target = await tx.backupTarget.create({
          data: {
            name: input.backup.targetName,
            type: input.backup.targetType,
            endpoint: input.backup.endpoint,
            basePath: input.backup.basePath,
            encryptionEnabled: true,
            secretCiphertext: encryptSettingSecret(generatedSecret),
          },
        });
        await tx.backupPlan.createMany({
          data: [
            {
              name: "CrewQual Database Daily",
              source: "DATABASE",
              mode: "FULL",
              targetId: target.id,
              cron: "0 2 * * *",
              timezone: input.timezone,
              retentionCount: 30,
              retentionDays: 90,
              enabled: true,
            },
            {
              name: "CrewQual Gallery Daily",
              source: "GALLERY",
              mode: "INCREMENTAL",
              targetId: target.id,
              cron: "0 2 * * *",
              timezone: input.timezone,
              retentionCount: 30,
              retentionDays: 90,
              enabled: true,
            },
          ],
        });
      }

      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          actorId: admin.id,
          action: "setup.completed",
          entityType: "Organization",
          entityId: organization.id,
          requestId: randomUUID(),
          detail: {
            locale: input.locale,
            timezone: input.timezone,
            templatePackCount: input.templatePackIds.length,
            backupEnabled: input.backup.enabled,
            notificationChannels: routes[0]?.channels ?? [],
          } as Prisma.InputJsonValue,
        },
      });

      return {
        completed: true,
        adminEmail: admin.email,
        installedTemplateCount: input.templatePackIds.length,
        installedPositionCount,
        storageMode: input.storage.mode,
        backupEnabled: input.backup.enabled,
        notificationChannels: routes[0]?.channels ?? [],
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
