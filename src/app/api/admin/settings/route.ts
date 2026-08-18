import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { ApiError, getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import {
  assertSuperAdminContinuity,
  isSuperAdmin,
  requireAssignedUnit,
} from "@/server/admin-permissions";
import { COOKIE_NAMES, hashPassword, requirePermission, verifyPassword } from "@/server/auth";
import { getServerConfig } from "@/server/config";
import {
  createTotpSecret,
  decryptSettingSecret,
  encryptSettingSecret,
  resolveTotpSecret,
  verifyTotp,
} from "@/server/crypto";
import { isLocalTestEndpoint } from "@/server/external-endpoint-safety";
import { getPrisma } from "@/server/prisma";
import type { AuthenticatedAdmin } from "@/server/auth";
import type {
  AdminSettingsSnapshot,
  AiIntegrationSetting,
  NotificationChannelSetting,
  NotificationRoute,
  SecurityPolicy,
  SettingsAdminAccount,
  SettingsAdminRole,
  SettingsAuditItem,
  SettingsPosition,
  SettingsSectionId,
  SettingsUnit,
} from "@/types/admin-settings";
/* eslint-disable @typescript-eslint/no-explicit-any */

const actionEnvelope = z.object({ action: z.string().min(1), input: z.unknown() });

const unitSchema = z.object({
  id: z.string().optional(),
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{2,32}$/),
  name: z.string().trim().min(1).max(128),
  timezone: z.string().trim().min(1).max(64),
  contactName: z.string().trim().max(128),
  contactEmail: z.union([z.string().email(), z.literal("")]),
  contactPhone: z.string().trim().max(32),
  active: z.boolean(),
  version: z.number().int().positive().optional(),
});

const positionSchema = z.object({
  id: z.string().optional(),
  organizationId: z.string().uuid().optional(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_-]{0,63}$/),
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().max(1000),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
  version: z.number().int().positive().optional(),
});

const adminSchema = z.object({
  id: z.string().optional(),
  displayName: z.string().trim().min(1).max(128),
  email: z.string().email(),
  unitId: z.string().nullable(),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "REVIEWER", "VIEWER"]),
  active: z.boolean(),
  temporaryPassword: z.string().min(12).max(256).optional(),
});

function totpProvisioningUri(email: string, secret: string) {
  const label = encodeURIComponent(`CrewQual:${email}`);
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=CrewQual`;
}

const notificationChannelSchema = z.object({
  key: z.enum(["feishu", "sms", "inApp"]),
  label: z.string(),
  enabled: z.boolean(),
  status: z.enum(["connected", "error", "unconfigured"]),
  endpoint: z.string(),
  secretConfigured: z.boolean(),
  timeoutSeconds: z.number().int().min(0).max(300),
  retryLimit: z.number().int().min(0).max(10),
  lastTestAt: z.string().nullable(),
  lastTestMessage: z.string(),
  version: z.number().int().positive(),
});

const routeSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  description: z.string().max(500),
  channels: z.array(z.enum(["feishu", "sms", "inApp"])).min(1),
});

const notificationSchema = z.object({
  unitId: z.string().uuid(),
  channels: z.array(notificationChannelSchema),
  routes: z.array(routeSchema),
});

const integrationSchema = z.object({
  key: z.enum(["feishu", "sms", "vlm"]),
  enabled: z.boolean(),
  endpoint: z.string().max(2000),
  model: z.string().max(256).optional(),
  timeoutSeconds: z.number().int().min(1).max(300),
  retryLimit: z.number().int().min(0).max(10).optional(),
  version: z.number().int().positive(),
  newSecret: z.string().max(4096).optional(),
});

const securitySchema = z.object({
  adminLoginMode: z.enum(["PASSWORD_TOTP", "TOTP_ONLY", "PASSWORD_ONLY"]),
  adminSessionTtlHours: z.number().int().min(1).max(72),
  pilotAccessLinkTtlMinutes: z.number().int().min(5).max(60),
  pilotSessionTtlMinutes: z.number().int().min(15).max(480),
  maxFailedAttempts: z.number().int().min(3).max(20),
  lockoutMinutes: z.number().int().min(5).max(1440),
  version: z.number().int().positive(),
  currentPassword: z.string().max(256).optional(),
  currentTotpCode: z.string().max(32).optional(),
});

const defaultRoutes: NotificationRoute[] = [
  {
    key: "qualification_expiry",
    label: "资质临期与过期提醒",
    description: "根据资质规则在临期或过期时提醒飞行员与管理员",
    channels: ["feishu", "sms", "inApp"],
  },
  {
    key: "review_approved",
    label: "审核通过",
    description: "管理员人工确认审核通过后发送结果",
    channels: ["feishu", "inApp"],
  },
  {
    key: "review_returned",
    label: "审核退回",
    description: "管理员退回申请并附带修改原因",
    channels: ["feishu", "sms", "inApp"],
  },
  {
    key: "upgrade_created",
    label: "升级计划创建",
    description: "升级计划创建并启动时通知相关人员",
    channels: ["feishu", "inApp"],
  },
  {
    key: "upgrade_rescheduled",
    label: "升级节点改期",
    description: "升级节点日期调整时发送变更通知",
    channels: ["feishu", "inApp"],
  },
  {
    key: "upgrade_completed",
    label: "升级节点完成",
    description: "登记升级节点结果后发送完成通知",
    channels: ["feishu", "inApp"],
  },
  {
    key: "delivery_failed",
    label: "通知发送失败",
    description: "外部渠道重试失败后提醒管理员",
    channels: ["inApp"],
  },
];

const sectionForAction = (action: string): SettingsSectionId => {
  if (action.startsWith("unit.")) return "organization";
  if (action.startsWith("position.")) return "positions";
  if (action.startsWith("admin.")) return "admins";
  if (action.startsWith("notification")) return "notifications";
  if (action.startsWith("integration")) return "ai";
  return "security";
};

function requireSuperAdmin(admin: AuthenticatedAdmin) {
  if (!isSuperAdmin(admin)) throw new ApiError("FORBIDDEN", "仅超级管理员可以执行此操作", 403);
}

async function assertCanRemoveSuperAdmin(
  db: any,
  targetId: string,
  nextRole: SettingsAdminRole,
  nextActive: boolean,
) {
  const target = await db.adminUser.findUnique({
    where: { id: targetId },
    select: {
      active: true,
      roles: { select: { role: { select: { code: true } } } },
    },
  });
  const currentlySuperAdmin =
    target?.active &&
    target.roles.some(
      (assignment: { role: { code: string } }) => assignment.role.code === "SUPER_ADMIN",
    );
  if (!currentlySuperAdmin || (nextActive && nextRole === "SUPER_ADMIN")) return;
  const otherActiveSuperAdmins = await db.adminUser.count({
    where: {
      id: { not: targetId },
      active: true,
      roles: { some: { role: { code: "SUPER_ADMIN" } } },
    },
  });
  assertSuperAdminContinuity({
    currentlySuperAdmin: true,
    activeSuperAdminCount: otherActiveSuperAdmins + 1,
    nextRole,
    nextActive,
  });
}

async function audit(
  admin: AuthenticatedAdmin,
  requestId: string,
  action: string,
  entityType: string,
  entityId: string,
  detail: Record<string, unknown>,
) {
  await getPrisma().auditEvent.create({
    data: {
      actorType: "admin",
      actorId: admin.id,
      action,
      entityType,
      entityId,
      detail: { section: sectionForAction(action), ...detail } as any,
      requestId,
    },
  });
}

function mapUnit(unit: any): SettingsUnit {
  return {
    id: unit.id,
    code: unit.code,
    name: unit.name,
    timezone: unit.timezone,
    contactName: unit.contactName,
    contactEmail: unit.contactEmail,
    contactPhone: unit.contactPhone,
    active: unit.active,
    adminCount: unit._count?.admins ?? 0,
    pilotCount: unit._count?.pilots ?? 0,
    updatedAt: unit.updatedAt.toISOString(),
    version: unit.version,
  };
}

function mapPosition(position: any): SettingsPosition {
  return {
    id: position.id,
    organizationId: position.organizationId,
    code: position.code,
    name: position.name,
    description: position.description ?? "",
    active: position.active,
    sortOrder: position.sortOrder,
    memberCount: position.assignments?.length ?? position._count?.assignments ?? 0,
    qualificationCount: position.requirements?.length ?? position._count?.requirements ?? 0,
    updatedAt: position.updatedAt.toISOString(),
    version: position.version,
  };
}

function mapAdmin(user: any): SettingsAdminAccount {
  const role = (user.roles?.[0]?.role?.code ?? "VIEWER") as SettingsAdminRole;
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    unitId: user.unitId,
    unitName: user.unit?.name ?? "全局",
    role,
    active: user.active,
    totpStatus: user.totpVerifiedAt ? "VERIFIED" : "PENDING_VERIFICATION",
    lastLoginAt: user.sessions?.[0]?.lastSeenAt?.toISOString() ?? null,
    activeSessionCount: user.sessions?.length ?? 0,
  };
}

function mapIntegration(
  key: "feishu" | "sms",
  record: any | undefined,
  config: ReturnType<typeof getServerConfig>,
): NotificationChannelSetting {
  const envEnabled =
    key === "feishu" ? config.FEISHU_ADAPTER === "webhook" : config.SMS_ADAPTER === "webhook";
  const envEndpoint = key === "feishu" ? config.FEISHU_WEBHOOK_URL : config.SMS_WEBHOOK_URL;
  const envSecret =
    key === "feishu" ? config.FEISHU_WEBHOOK_AUTH_TOKEN : config.SMS_WEBHOOK_AUTH_TOKEN;
  const enabled = record?.enabled ?? envEnabled;
  const endpoint = record?.endpoint || envEndpoint;
  const secretConfigured = Boolean(record?.secretCiphertext || envSecret);
  return {
    key,
    label: key === "feishu" ? "飞书" : "短信",
    enabled,
    status:
      record?.lastTestStatus === "error"
        ? "error"
        : enabled && endpoint
          ? "connected"
          : "unconfigured",
    endpoint,
    secretConfigured,
    timeoutSeconds: record?.timeoutSeconds ?? 10,
    retryLimit: record?.retryLimit ?? 3,
    lastTestAt: record?.lastTestedAt?.toISOString() ?? null,
    lastTestMessage:
      record?.lastTestMessage ||
      (enabled && endpoint ? "已配置，等待连接测试" : "尚未配置 Webhook"),
    version: record?.version ?? 1,
  };
}

async function loadSnapshot(
  admin: AuthenticatedAdmin,
  requestedUnitId?: string | null,
): Promise<AdminSettingsSnapshot> {
  const db = getPrisma();
  const superAdmin = isSuperAdmin(admin);
  const unitWhere = superAdmin ? {} : { id: requireAssignedUnit(admin)! };
  const positionOrganizationId = superAdmin
    ? (requestedUnitId ?? undefined)
    : (admin.organizationId ?? requireAssignedUnit(admin));
  const [units, positions, admins, integrations, policy, sessions, auditItems] = await Promise.all([
    db.organizationUnit.findMany({
      where: unitWhere,
      include: { _count: { select: { admins: true, pilots: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    db.position.findMany({
      where: positionOrganizationId ? { organizationId: positionOrganizationId } : {},
      include: {
        assignments: { where: { status: "ACTIVE" }, select: { id: true } },
        requirements: { where: { active: true }, select: { id: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    superAdmin
      ? db.adminUser.findMany({
          include: {
            unit: true,
            roles: { include: { role: true } },
            sessions: { where: { expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } },
          },
          orderBy: { displayName: "asc" },
        })
      : Promise.resolve([]),
    superAdmin ? db.systemIntegrationSetting.findMany() : Promise.resolve([]),
    db.securityPolicy.findUnique({ where: { id: "global" } }),
    db.adminSession.findMany({
      where: {
        expiresAt: { gt: new Date() },
        ...(superAdmin ? {} : { userId: admin.id }),
      },
      include: { user: true },
      orderBy: { lastSeenAt: "desc" },
      take: 50,
    }),
    superAdmin
      ? db.auditEvent.findMany({
          where: {
            OR: [
              {
                entityType: {
                  in: [
                    "OrganizationUnit",
                    "AdminUser",
                    "SystemIntegrationSetting",
                    "SecurityPolicy",
                    "AdminSession",
                  ],
                },
              },
              { action: { startsWith: "settings." } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
  ]);
  const routeUnit = isSuperAdmin(admin)
    ? requestedUnitId
      ? units.find((item: any) => item.id === requestedUnitId)
      : undefined
    : units.find((item: any) => item.id === admin.unitId);
  if (requestedUnitId && !routeUnit) {
    throw new ApiError("UNIT_NOT_ALLOWED", "通知配置单位不存在或无权访问", 404);
  }
  const channelState =
    routeUnit?.notificationChannelState &&
    typeof routeUnit.notificationChannelState === "object" &&
    !Array.isArray(routeUnit.notificationChannelState)
      ? (routeUnit.notificationChannelState as Record<string, unknown>)
      : {};
  const config = getServerConfig();
  const integrationMap = new Map(integrations.map((item: any) => [item.key, item]));
  const notificationChannels: NotificationChannelSetting[] = [
    {
      ...mapIntegration("feishu", integrationMap.get("feishu"), config),
      enabled:
        mapIntegration("feishu", integrationMap.get("feishu"), config).enabled &&
        channelState.feishu === true,
    },
    {
      ...mapIntegration("sms", integrationMap.get("sms"), config),
      enabled:
        mapIntegration("sms", integrationMap.get("sms"), config).enabled &&
        channelState.sms === true,
    },
    {
      key: "inApp",
      label: "站内通知",
      enabled: channelState.inApp !== false,
      status: "connected",
      endpoint: "",
      secretConfigured: false,
      timeoutSeconds: 0,
      retryLimit: 0,
      lastTestAt: new Date().toISOString(),
      lastTestMessage: "系统内置渠道",
      version: 1,
    },
  ];
  const vlm = integrationMap.get("vlm") as any;
  const ai: AiIntegrationSetting = {
    key: "vlm",
    enabled: vlm?.enabled ?? config.VLM_ADAPTER === "qwen",
    status:
      vlm?.lastTestStatus === "error"
        ? "error"
        : (vlm?.enabled ?? config.VLM_ADAPTER === "qwen")
          ? "connected"
          : "unconfigured",
    endpoint: vlm?.endpoint || config.QWEN_BASE_URL,
    model: vlm?.model || config.QWEN_MODEL,
    secretConfigured: Boolean(vlm?.secretCiphertext),
    timeoutSeconds: vlm?.timeoutSeconds ?? 120,
    lastTestAt: vlm?.lastTestedAt?.toISOString() ?? null,
    lastTestMessage: vlm?.lastTestMessage || "已读取服务器默认配置",
    version: vlm?.version ?? 1,
  };
  const fallbackPolicy: SecurityPolicy = {
    adminLoginMode: "PASSWORD_TOTP",
    adminSessionTtlHours: config.ADMIN_SESSION_TTL_HOURS,
    pilotAccessLinkTtlMinutes: 15,
    pilotSessionTtlMinutes: config.PILOT_SESSION_TTL_MINUTES,
    maxFailedAttempts: 5,
    lockoutMinutes: 15,
    version: 1,
  };
  const actorIds = [
    ...new Set(auditItems.map((item: any) => item.actorId).filter(Boolean)),
  ] as string[];
  const actors = actorIds.length
    ? await db.adminUser.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const actorMap = new Map(actors.map((item: any) => [item.id, item.displayName]));
  const mappedAudit: SettingsAuditItem[] = auditItems.map((item: any) => {
    const detail = (item.detail ?? {}) as Record<string, unknown>;
    return {
      id: item.id,
      actor: actorMap.get(item.actorId) ?? "系统管理员",
      action: actionLabel(item.action),
      section: (detail.section as SettingsSectionId) ?? sectionForAction(item.action),
      unitName: String(detail.unitName ?? "全局"),
      summary: String(detail.summary ?? "设置已更新；敏感值未写入审计"),
      occurredAt: item.createdAt.toISOString(),
    };
  });
  const storedRoutes = Array.isArray(routeUnit?.notificationRouting)
    ? (routeUnit.notificationRouting as NotificationRoute[])
    : [];
  return {
    units: units.map(mapUnit),
    positions: positions.map(mapPosition),
    admins: admins.map(mapAdmin),
    notificationChannels,
    notificationRoutes: storedRoutes.length ? storedRoutes : defaultRoutes,
    notificationUnitId: routeUnit?.id ?? null,
    ai,
    security: policy
      ? {
          adminLoginMode: policy.adminLoginMode,
          adminSessionTtlHours: policy.adminSessionTtlHours,
          pilotAccessLinkTtlMinutes: policy.pilotAccessLinkTtlMinutes,
          pilotSessionTtlMinutes: policy.pilotSessionTtlMinutes,
          maxFailedAttempts: policy.maxFailedAttempts,
          lockoutMinutes: policy.lockoutMinutes,
          version: policy.version,
        }
      : fallbackPolicy,
    sessions: sessions.map((item: any) => ({
      id: item.id,
      adminName: item.user.displayName,
      browser: "管理端浏览器",
      maskedIp: "已脱敏",
      createdAt: item.createdAt.toISOString(),
      lastSeenAt: item.lastSeenAt.toISOString(),
      current: item.id === admin.sessionId,
    })),
    audit: mappedAudit,
    systemHealth: [
      {
        key: "database",
        label: "数据库",
        status: "connected",
        detail: "PostgreSQL 连接正常",
        checkedAt: new Date().toISOString(),
      },
      {
        key: "storage",
        label: "对象存储",
        status:
          config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY ? "connected" : "unconfigured",
        detail: config.S3_ACCESS_KEY_ID
          ? `私有存储桶 ${config.S3_BUCKET} 已配置`
          : "对象存储凭据未配置",
        checkedAt: new Date().toISOString(),
      },
      {
        key: "worker",
        label: "后台任务 Worker",
        status: "unconfigured",
        detail: "请通过部署监控确认 Worker 心跳",
        checkedAt: new Date().toISOString(),
      },
      {
        key: "queue",
        label: "通知队列",
        status: "connected",
        detail: "任务队列数据库可访问",
        checkedAt: new Date().toISOString(),
      },
    ],
  };
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    "settings.unit.created": "创建运行单位",
    "settings.unit.updated": "更新单位设置",
    "settings.position.created": "创建职位",
    "settings.position.updated": "更新职位设置",
    "settings.position.deleted": "删除职位",
    "settings.position.force_deleted": "强制删除职位",
    "settings.admin.created": "创建管理员账号",
    "settings.admin.updated": "更新管理员账号",
    "settings.admin.action": "执行管理员账号操作",
    "settings.notifications.updated": "更新通知路由",
    "settings.integration.updated": "更新系统集成",
    "settings.integration.tested": "测试系统集成",
    "settings.security.updated": "更新安全策略",
    "settings.session.revoked": "结束管理员会话",
  };
  return labels[action] ?? action;
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "settings.read");
    const requestedUnitId = new URL(request.url).searchParams.get("unitId");
    const data = await loadSnapshot(admin, requestedUnitId);
    const response = jsonData(data, requestId);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return jsonError(error, requestId);
  }
}

export async function PATCH(request: NextRequest) {
  return mutateSettings(request, "PATCH");
}

export async function POST(request: NextRequest) {
  return mutateSettings(request, "POST");
}

async function mutateSettings(request: NextRequest, method: "PATCH" | "POST") {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "settings.read", true);
    const envelope = await parseJson(request, actionEnvelope);
    const db = getPrisma();

    if (method === "PATCH" && envelope.action === "unit.save") {
      requirePermission(admin, "settings.units.write");
      const input = unitSchema.parse(envelope.input);
      if (!input.id) throw new ApiError("VALIDATION_ERROR", "缺少单位 ID", 422);
      if (!isSuperAdmin(admin) && input.id !== requireAssignedUnit(admin)) {
        throw new ApiError("FORBIDDEN", "不能修改其他单位", 403);
      }
      const updated = await db.organizationUnit.updateMany({
        where: { id: input.id, ...(input.version ? { version: input.version } : {}) },
        data: {
          name: input.name,
          timezone: input.timezone,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          ...(isSuperAdmin(admin) ? { active: input.active } : {}),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error("VERSION_CONFLICT");
      const unit = await db.organizationUnit.findUniqueOrThrow({
        where: { id: input.id },
        include: { _count: { select: { admins: true, pilots: true } } },
      });
      if (unit.organizationId) {
        await db.organization.update({
          where: { id: unit.organizationId },
          data: { name: unit.name, active: unit.active },
        });
      }
      await audit(admin, requestId, "settings.unit.updated", "OrganizationUnit", unit.id, {
        summary: `更新单位 ${unit.name} 的基础信息`,
        unitName: unit.name,
      });
      return jsonData(mapUnit(unit), requestId);
    }

    if (method === "POST" && envelope.action === "unit.create") {
      requirePermission(admin, "settings.units.write");
      requireSuperAdmin(admin);
      const input = unitSchema.omit({ id: true, version: true }).parse(envelope.input);
      const unit = await db.$transaction(async (tx) => {
        const created = await tx.organizationUnit.create({
          data: { ...input, notificationRouting: defaultRoutes as any },
          include: { _count: { select: { admins: true, pilots: true } } },
        });
        await tx.organization.create({
          data: { id: created.id, code: created.code, name: created.name, active: created.active },
        });
        return tx.organizationUnit.update({
          where: { id: created.id },
          data: { organizationId: created.id, parentId: null },
          include: { _count: { select: { admins: true, pilots: true } } },
        });
      });
      await audit(admin, requestId, "settings.unit.created", "OrganizationUnit", unit.id, {
        summary: `创建运行单位 ${unit.name}`,
        unitName: unit.name,
      });
      return jsonData(mapUnit(unit), requestId, 201);
    }

    if (method === "POST" && envelope.action === "position.create") {
      requirePermission(admin, "settings.positions.write");
      const input = positionSchema.omit({ id: true, version: true }).parse(envelope.input);
      const organizationId = isSuperAdmin(admin)
        ? input.organizationId
        : (admin.organizationId ?? requireAssignedUnit(admin));
      if (!organizationId) {
        throw new ApiError("ORGANIZATION_REQUIRED", "请先选择职位所属组织", 422);
      }
      const duplicate = await db.position.findUnique({
        where: { organizationId_code: { organizationId, code: input.code } },
        select: { id: true },
      });
      if (duplicate) throw new ApiError("DUPLICATE_POSITION", "职位编码已存在", 409);
      const position = await db.position.create({
        data: { ...input, organizationId },
        include: {
          assignments: { where: { status: "ACTIVE" }, select: { id: true } },
          requirements: { where: { active: true }, select: { id: true } },
        },
      });
      await audit(admin, requestId, "settings.position.created", "Position", position.id, {
        summary: `创建职位 ${position.name}`,
      });
      return jsonData(mapPosition(position), requestId, 201);
    }

    if (method === "PATCH" && envelope.action === "position.save") {
      requirePermission(admin, "settings.positions.write");
      const input = positionSchema.required({ id: true, version: true }).parse(envelope.input);
      const current = await db.position.findUnique({
        where: { id: input.id },
        select: { organizationId: true, code: true },
      });
      if (!current) throw new ApiError("NOT_FOUND", "职位不存在", 404);
      const allowedOrganization = isSuperAdmin(admin)
        ? true
        : current.organizationId === (admin.organizationId ?? requireAssignedUnit(admin));
      if (!allowedOrganization) throw new ApiError("FORBIDDEN", "不能修改其他组织的职位", 403);
      if (input.code !== current.code) {
        throw new ApiError("POSITION_CODE_IMMUTABLE", "职位编码创建后不可修改", 422);
      }
      const updated = await db.position.updateMany({
        where: { id: input.id, version: input.version },
        data: {
          name: input.name,
          description: input.description,
          active: input.active,
          sortOrder: input.sortOrder,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error("VERSION_CONFLICT");
      const position = await db.position.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          assignments: { where: { status: "ACTIVE" }, select: { id: true } },
          requirements: { where: { active: true }, select: { id: true } },
        },
      });
      await audit(admin, requestId, "settings.position.updated", "Position", position.id, {
        summary: `更新职位 ${position.name}`,
      });
      return jsonData(mapPosition(position), requestId);
    }

    if (method === "POST" && envelope.action === "position.delete") {
      requirePermission(admin, "settings.positions.write");
      const input = z
        .object({
          id: z.string().uuid(),
          version: z.number().int().positive(),
          force: z.boolean().optional().default(false),
        })
        .parse(envelope.input);
      if (input.force) requireSuperAdmin(admin);
      const result = await db.$transaction(async (tx) => {
        const current = await tx.position.findUnique({
          where: { id: input.id },
          select: { id: true, organizationId: true, code: true, name: true, version: true },
        });
        if (!current) throw new ApiError("NOT_FOUND", "职位不存在", 404);
        const allowedOrganization = isSuperAdmin(admin)
          ? true
          : current.organizationId === (admin.organizationId ?? requireAssignedUnit(admin));
        if (!allowedOrganization) throw new ApiError("FORBIDDEN", "不能删除其他组织的职位", 403);
        if (current.version !== input.version) {
          throw new ApiError("VERSION_CONFLICT", "职位已被其他管理员修改，请刷新后重试", 409);
        }
        const locked = await tx.position.updateMany({
          where: { id: current.id, version: input.version },
          data: { version: { increment: 1 } },
        });
        if (locked.count !== 1) {
          throw new ApiError("VERSION_CONFLICT", "职位已被其他管理员修改，请刷新后重试", 409);
        }

        const [assignments, requirements] = await Promise.all([
          tx.personPositionAssignment.findMany({
            where: { positionId: current.id },
            select: { id: true },
          }),
          tx.qualificationRequirement.findMany({
            where: { positionId: current.id },
            select: { id: true },
          }),
        ]);
        const assignmentIds = assignments.map((assignment) => assignment.id);
        const requirementIds = requirements.map((requirement) => requirement.id);
        const [qualificationAssignments, upgradePlans] = await Promise.all([
          tx.qualificationAssignment.count({
            where: {
              OR: [
                ...(requirementIds.length ? [{ requirementId: { in: requirementIds } }] : []),
                ...(assignmentIds.length ? [{ positionAssignmentId: { in: assignmentIds } }] : []),
              ],
            },
          }),
          tx.upgradePlan.count({
            where: {
              OR: [
                ...(assignmentIds.length ? [{ positionAssignmentId: { in: assignmentIds } }] : []),
                {
                  positionCodeSnapshot: current.code,
                  OR: [
                    { person: { organizationId: current.organizationId } },
                    { pilot: { unit: { organizationId: current.organizationId } } },
                  ],
                },
              ],
            },
          }),
        ]);
        const history = {
          memberAssignments: assignments.length,
          qualificationRequirements: requirements.length,
          qualificationAssignments,
          upgradePlans,
        };
        const hasHistory = Object.values(history).some((value) => value > 0);
        if (hasHistory && !input.force) {
          throw new ApiError(
            "POSITION_HAS_HISTORY",
            "职位存在历史关联，无法安全删除",
            409,
            undefined,
            {
              ...history,
              positionCode: current.code,
              positionName: current.name,
            },
          );
        }

        if (input.force) {
          const endedAt = new Date();
          if (assignmentIds.length) {
            await tx.personPositionAssignment.updateMany({
              where: { id: { in: assignmentIds }, status: "ACTIVE" },
              data: {
                status: "ENDED",
                isPrimary: false,
                effectiveTo: endedAt,
                positionCodeSnapshot: current.code,
                positionNameSnapshot: current.name,
                version: { increment: 1 },
              },
            });
          }
          await tx.qualificationAssignment.updateMany({
            where: {
              active: true,
              OR: [
                ...(assignmentIds.length ? [{ positionAssignmentId: { in: assignmentIds } }] : []),
                ...(requirementIds.length ? [{ requirementId: { in: requirementIds } }] : []),
              ],
            },
            data: { active: false, endedAt, version: { increment: 1 } },
          });
          if (assignmentIds.length) {
            await tx.personPositionAssignment.updateMany({
              where: { id: { in: assignmentIds } },
              data: {
                positionId: null,
                positionCodeSnapshot: current.code,
                positionNameSnapshot: current.name,
              },
            });
          }
        }

        await tx.position.delete({ where: { id: current.id } });
        return { id: current.id, forced: Boolean(input.force), history };
      });
      await audit(
        admin,
        requestId,
        result.forced ? "settings.position.force_deleted" : "settings.position.deleted",
        "Position",
        result.id,
        {
          summary: result.forced ? "强制删除职位并保留历史记录" : "删除无历史关联职位",
          forced: result.forced,
          ...result.history,
        },
      );
      return jsonData({ id: result.id, forced: result.forced }, requestId);
    }

    if (method === "PATCH" && envelope.action === "admin.save") {
      requirePermission(admin, "settings.admins.write");
      requireSuperAdmin(admin);
      const input = adminSchema.parse(envelope.input);
      if (!input.id) throw new ApiError("VALIDATION_ERROR", "缺少管理员 ID", 422);
      const adminId = input.id;
      if (adminId === admin.id && (!input.active || input.role !== "SUPER_ADMIN")) {
        throw new ApiError("SELF_LOCKOUT", "不能停用当前账号或移除自己的超级管理员角色", 409);
      }
      if (input.role !== "SUPER_ADMIN" && !input.unitId) {
        throw new ApiError("UNIT_REQUIRED", "非超级管理员必须选择所属单位", 422);
      }
      const role = await db.role.findUniqueOrThrow({ where: { code: input.role } });
      await db.$transaction(async (tx) => {
        await assertCanRemoveSuperAdmin(tx, adminId, input.role, input.active);
        await tx.adminUser.update({
          where: { id: adminId },
          data: {
            displayName: input.displayName,
            email: input.email.toLowerCase(),
            unitId: input.role === "SUPER_ADMIN" ? null : input.unitId,
            organizationId: input.role === "SUPER_ADMIN" ? null : input.unitId,
            active: input.active,
            version: { increment: 1 },
          },
        });
        await tx.adminUserRole.deleteMany({ where: { userId: adminId } });
        await tx.adminUserRole.create({ data: { userId: adminId, roleId: role.id } });
        if (!input.active) await tx.adminSession.deleteMany({ where: { userId: adminId } });
      });
      const user = await readAdmin(adminId);
      await audit(admin, requestId, "settings.admin.updated", "AdminUser", adminId, {
        summary: `更新管理员 ${input.displayName} 的账号资料和角色`,
        unitName: user.unitName,
      });
      return jsonData(user, requestId);
    }

    if (method === "POST" && envelope.action === "admin.create") {
      requirePermission(admin, "settings.admins.write");
      requireSuperAdmin(admin);
      const input = adminSchema.omit({ id: true }).parse(envelope.input);
      if (!input.temporaryPassword) throw new ApiError("PASSWORD_REQUIRED", "请输入临时密码", 422);
      if (input.role !== "SUPER_ADMIN" && !input.unitId) {
        throw new ApiError("UNIT_REQUIRED", "非超级管理员必须选择所属单位", 422);
      }
      const role = await db.role.findUniqueOrThrow({ where: { code: input.role } });
      const totpSecret = createTotpSecret();
      const user = await db.adminUser.create({
        data: {
          email: input.email.toLowerCase(),
          displayName: input.displayName,
          passwordHash: await hashPassword(input.temporaryPassword),
          totpSecretCiphertext: encryptSettingSecret(totpSecret),
          active: input.active,
          unitId: input.role === "SUPER_ADMIN" ? null : input.unitId,
          organizationId: input.role === "SUPER_ADMIN" ? null : input.unitId,
          roles: { create: { roleId: role.id } },
        },
      });
      const mapped = await readAdmin(user.id);
      await audit(admin, requestId, "settings.admin.created", "AdminUser", user.id, {
        summary: `创建管理员 ${input.displayName}；密码和双重验证密钥未写入审计`,
        unitName: mapped.unitName,
      });
      return jsonData(
        {
          ...mapped,
          oneTimeTotpSecret: totpSecret,
          oneTimeTotpUri: totpProvisioningUri(mapped.email, totpSecret),
        },
        requestId,
        201,
      );
    }

    if (method === "POST" && envelope.action === "admin.action") {
      requirePermission(admin, "settings.admins.write");
      requireSuperAdmin(admin);
      const input = z
        .object({
          id: z.string(),
          action: z.enum(["disable", "enable", "resetPassword", "resetTotp", "revokeSessions"]),
          value: z.string().optional(),
        })
        .parse(envelope.input);
      if (input.id === admin.id && ["disable", "revokeSessions"].includes(input.action)) {
        throw new ApiError("SELF_LOCKOUT", "不能通过账号管理结束当前会话或停用自己", 409);
      }
      if (input.action === "resetPassword") {
        if (!input.value || input.value.length < 12)
          throw new ApiError("PASSWORD_REQUIRED", "新临时密码至少需要 12 个字符", 422);
        const passwordHash = await hashPassword(input.value);
        await db.$transaction(async (tx) => {
          await tx.adminUser.update({
            where: { id: input.id },
            data: { passwordHash, version: { increment: 1 } },
          });
          await tx.adminSession.deleteMany({ where: { userId: input.id } });
        });
      } else if (input.action === "resetTotp") {
        const totpSecret = createTotpSecret();
        await db.$transaction(async (tx) => {
          await tx.adminUser.update({
            where: { id: input.id },
            data: {
              totpSecretCiphertext: encryptSettingSecret(totpSecret),
              totpVerifiedAt: null,
              lastTotpCounter: null,
              version: { increment: 1 },
            },
          });
          await tx.adminSession.deleteMany({ where: { userId: input.id } });
        });
        const user = await readAdmin(input.id);
        await audit(admin, requestId, "settings.admin.action", "AdminUser", input.id, {
          summary: `执行账号操作：${input.action}；敏感值未写入审计`,
          unitName: user.unitName,
        });
        return jsonData(
          {
            ...user,
            oneTimeTotpSecret: totpSecret,
            oneTimeTotpUri: totpProvisioningUri(user.email, totpSecret),
          },
          requestId,
        );
      } else if (input.action === "disable") {
        await db.$transaction(async (tx) => {
          await assertCanRemoveSuperAdmin(tx, input.id, "SUPER_ADMIN", false);
          await tx.adminUser.update({
            where: { id: input.id },
            data: { active: false, version: { increment: 1 } },
          });
          await tx.adminSession.deleteMany({ where: { userId: input.id } });
        });
      } else if (input.action === "enable") {
        await db.adminUser.update({
          where: { id: input.id },
          data: { active: true, version: { increment: 1 } },
        });
      } else {
        await db.adminSession.deleteMany({ where: { userId: input.id } });
      }
      const user = await readAdmin(input.id);
      await audit(admin, requestId, "settings.admin.action", "AdminUser", input.id, {
        summary: `执行账号操作：${input.action}；敏感值未写入审计`,
        unitName: user.unitName,
      });
      return jsonData(user, requestId);
    }

    if (method === "PATCH" && envelope.action === "notifications.save") {
      requirePermission(admin, "settings.notifications.write");
      const input = notificationSchema.parse(envelope.input);
      const unitId = input.unitId;
      if (!isSuperAdmin(admin) && unitId !== requireAssignedUnit(admin)) {
        throw new ApiError("UNIT_NOT_ALLOWED", "只能维护本人所属单位的通知配置", 403);
      }
      const exists = await db.organizationUnit.findFirst({
        where: { id: unitId, active: true },
        select: { id: true },
      });
      if (!exists) throw new ApiError("UNIT_REQUIRED", "请选择有效的运行单位", 422);
      const channelState = Object.fromEntries(
        input.channels.map((channel) => [channel.key, channel.enabled]),
      );
      const unit = await db.organizationUnit.update({
        where: { id: unitId },
        data: {
          notificationRouting: input.routes as any,
          notificationChannelState: channelState as any,
          version: { increment: 1 },
        },
      });
      await audit(admin, requestId, "settings.notifications.updated", "OrganizationUnit", unitId, {
        summary: "更新通知路由规则",
        unitName: unit.name,
      });
      return jsonData(input, requestId);
    }

    if (method === "PATCH" && envelope.action === "integration.save") {
      requirePermission(admin, "settings.security.write");
      requireSuperAdmin(admin);
      const input = integrationSchema.parse(envelope.input);
      const current = await db.systemIntegrationSetting.findUnique({ where: { key: input.key } });
      if (current && current.version !== input.version) throw new Error("VERSION_CONFLICT");
      const record = await db.systemIntegrationSetting.upsert({
        where: { key: input.key },
        update: {
          enabled: input.enabled,
          endpoint: input.endpoint,
          model: input.model ?? "",
          timeoutSeconds: input.timeoutSeconds,
          retryLimit: input.retryLimit ?? 0,
          ...(input.newSecret ? { secretCiphertext: encryptSettingSecret(input.newSecret) } : {}),
          version: { increment: 1 },
        },
        create: {
          key: input.key,
          enabled: input.enabled,
          endpoint: input.endpoint,
          model: input.model ?? "",
          timeoutSeconds: input.timeoutSeconds,
          retryLimit: input.retryLimit ?? 0,
          secretCiphertext: input.newSecret ? encryptSettingSecret(input.newSecret) : null,
        },
      });
      await audit(
        admin,
        requestId,
        "settings.integration.updated",
        "SystemIntegrationSetting",
        input.key,
        {
          summary: `更新 ${input.key} 集成配置；密钥原文未写入审计`,
        },
      );
      return jsonData(serializeIntegration(record), requestId);
    }

    if (method === "POST" && envelope.action === "integration.test") {
      requirePermission(admin, "settings.security.write");
      requireSuperAdmin(admin);
      const { key } = z.object({ key: z.enum(["feishu", "sms", "vlm"]) }).parse(envelope.input);
      const record = await db.systemIntegrationSetting.findUnique({ where: { key } });
      const testedAt = new Date();
      let ok = false;
      let message = "尚未保存或启用该集成";
      if (record?.enabled && record.endpoint) {
        if (!isLocalTestEndpoint(record.endpoint)) {
          message = "为避免真实外发，连接测试只允许访问本机假服务地址";
        } else {
          try {
            const secret = record.secretCiphertext
              ? decryptSettingSecret(record.secretCiphertext)
              : "";
            const response = await fetch(
              key === "vlm" ? `${record.endpoint.replace(/\/$/, "")}/models` : record.endpoint,
              {
                method: key === "vlm" ? "GET" : "POST",
                headers: {
                  ...(key !== "vlm" ? { "content-type": "application/json" } : {}),
                  ...(secret ? { authorization: `Bearer ${secret}` } : {}),
                },
                ...(key !== "vlm"
                  ? {
                      body: JSON.stringify({
                        type: "crewqual_connection_test",
                        message: "CrewQual 渠道连接测试",
                      }),
                    }
                  : {}),
                signal: AbortSignal.timeout(record.timeoutSeconds * 1000),
              },
            );
            ok = response.ok;
            message = ok ? "连接成功，服务响应正常" : `服务返回 HTTP ${response.status}`;
          } catch (error) {
            message = error instanceof Error ? error.message : "连接测试失败";
          }
        }
      }
      await db.systemIntegrationSetting
        .update({
          where: { key },
          data: {
            lastTestStatus: ok ? "connected" : "error",
            lastTestMessage: message,
            lastTestedAt: testedAt,
          },
        })
        .catch(() => undefined);
      await audit(
        admin,
        requestId,
        "settings.integration.tested",
        "SystemIntegrationSetting",
        key,
        {
          summary: `${key} 连接测试：${ok ? "成功" : "失败"}`,
        },
      );
      return jsonData({ ok, message, testedAt: testedAt.toISOString() }, requestId);
    }

    if (method === "PATCH" && envelope.action === "security.save") {
      requirePermission(admin, "settings.security.write");
      requireSuperAdmin(admin);
      const input = securitySchema.parse(envelope.input);
      const current = await db.securityPolicy.findUnique({ where: { id: "global" } });
      if (current && current.version !== input.version) throw new Error("VERSION_CONFLICT");
      const previousMode = current?.adminLoginMode ?? "PASSWORD_TOTP";
      const modeChanged = previousMode !== input.adminLoginMode;
      const needsPassword = input.adminLoginMode !== "TOTP_ONLY";
      const needsTotp = input.adminLoginMode !== "PASSWORD_ONLY";
      const policyData = {
        adminLoginMode: input.adminLoginMode,
        adminSessionTtlHours: input.adminSessionTtlHours,
        pilotAccessLinkTtlMinutes: input.pilotAccessLinkTtlMinutes,
        pilotSessionTtlMinutes: input.pilotSessionTtlMinutes,
        maxFailedAttempts: input.maxFailedAttempts,
        lockoutMinutes: input.lockoutMinutes,
      };

      const actor = modeChanged
        ? await db.adminUser.findUniqueOrThrow({
            where: { id: admin.id },
            select: {
              passwordHash: true,
              totpSecretCiphertext: true,
              totpVerifiedAt: true,
              lastTotpCounter: true,
            },
          })
        : null;
      const passwordOk =
        !modeChanged ||
        !needsPassword ||
        (actor ? await verifyPassword(actor.passwordHash, input.currentPassword ?? "") : false);
      const totpCounter =
        modeChanged && needsTotp && actor
          ? verifyTotp(resolveTotpSecret(actor.totpSecretCiphertext), input.currentTotpCode ?? "")
          : null;
      const totpOk = !modeChanged || !needsTotp || totpCounter !== null;
      if (!passwordOk || !totpOk) {
        throw new ApiError("INVALID_CREDENTIALS", "当前管理员凭据验证失败", 401);
      }
      if (
        modeChanged &&
        needsTotp &&
        actor?.lastTotpCounter !== null &&
        actor?.lastTotpCounter !== undefined &&
        totpCounter !== null &&
        BigInt(totpCounter) <= actor.lastTotpCounter
      ) {
        throw new ApiError("INVALID_CREDENTIALS", "当前动态验证码已使用，请等待下一组验证码", 401);
      }

      const policy = await db.$transaction(async (tx) => {
        const saved = await tx.securityPolicy.upsert({
          where: { id: "global" },
          update: { ...policyData, version: { increment: 1 } },
          create: { id: "global", ...policyData },
        });
        if (modeChanged) {
          await tx.adminSession.deleteMany({});
          if (actor && needsTotp && totpCounter !== null) {
            await tx.adminUser.update({
              where: { id: admin.id },
              data: {
                totpVerifiedAt: actor.totpVerifiedAt ?? new Date(),
                lastTotpCounter: BigInt(totpCounter),
              },
            });
          }
          await tx.auditEvent.create({
            data: {
              actorType: "admin",
              actorId: admin.id,
              action: "settings.security.updated",
              entityType: "SecurityPolicy",
              entityId: "global",
              detail: {
                section: "security",
                summary: "更新全局安全与会话策略；登录模式切换后已撤销全部管理员会话",
                previousLoginMode: previousMode,
                loginMode: input.adminLoginMode,
                sessionsRevoked: true,
              },
              requestId,
            },
          });
        } else {
          await tx.auditEvent.create({
            data: {
              actorType: "admin",
              actorId: admin.id,
              action: "settings.security.updated",
              entityType: "SecurityPolicy",
              entityId: "global",
              detail: { section: "security", summary: "更新全局安全与会话策略" },
              requestId,
            },
          });
        }
        return saved;
      });
      if (modeChanged) {
        const store = await cookies();
        store.delete(COOKIE_NAMES.admin);
        store.delete(`${COOKIE_NAMES.admin}_csrf`);
      }
      return jsonData(
        {
          policy: {
            adminLoginMode: policy.adminLoginMode,
            adminSessionTtlHours: policy.adminSessionTtlHours,
            pilotAccessLinkTtlMinutes: policy.pilotAccessLinkTtlMinutes,
            pilotSessionTtlMinutes: policy.pilotSessionTtlMinutes,
            maxFailedAttempts: policy.maxFailedAttempts,
            lockoutMinutes: policy.lockoutMinutes,
            version: policy.version,
          },
          reauthenticate: modeChanged,
        },
        requestId,
      );
    }

    if (method === "POST" && envelope.action === "session.revoke") {
      requirePermission(admin, "settings.security.write");
      requireSuperAdmin(admin);
      const { id } = z.object({ id: z.string() }).parse(envelope.input);
      if (id === admin.sessionId)
        throw new ApiError("SELF_LOCKOUT", "请使用退出登录结束当前会话", 409);
      await db.adminSession.delete({ where: { id } });
      await audit(admin, requestId, "settings.session.revoked", "AdminSession", id, {
        summary: "结束管理员活跃会话",
      });
      return jsonData({ revoked: true }, requestId);
    }

    throw new ApiError("UNKNOWN_SETTINGS_ACTION", "不支持的系统设置操作", 400);
  } catch (error) {
    return jsonError(error, requestId);
  }
}

async function readAdmin(id: string) {
  const user = await getPrisma().adminUser.findUniqueOrThrow({
    where: { id },
    include: {
      unit: true,
      roles: { include: { role: true } },
      sessions: { where: { expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } },
    },
  });
  return mapAdmin(user);
}

function serializeIntegration(record: any): NotificationChannelSetting | AiIntegrationSetting {
  if (record.key === "vlm") {
    return {
      key: "vlm",
      enabled: record.enabled,
      status:
        record.lastTestStatus === "error" ? "error" : record.enabled ? "connected" : "unconfigured",
      endpoint: record.endpoint,
      model: record.model,
      secretConfigured: Boolean(record.secretCiphertext),
      timeoutSeconds: record.timeoutSeconds,
      lastTestAt: record.lastTestedAt?.toISOString() ?? null,
      lastTestMessage: record.lastTestMessage || "配置已保存，等待连接测试",
      version: record.version,
    };
  }
  return {
    key: record.key,
    label: record.key === "feishu" ? "飞书" : "短信",
    enabled: record.enabled,
    status:
      record.lastTestStatus === "error" ? "error" : record.enabled ? "connected" : "unconfigured",
    endpoint: record.endpoint,
    secretConfigured: Boolean(record.secretCiphertext),
    timeoutSeconds: record.timeoutSeconds,
    retryLimit: record.retryLimit,
    lastTestAt: record.lastTestedAt?.toISOString() ?? null,
    lastTestMessage: record.lastTestMessage || "配置已保存，等待连接测试",
    version: record.version,
  };
}
