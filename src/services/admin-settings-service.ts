import type {
  AdminSettingsSnapshot,
  MediaOptimizationSetting,
  AiIntegrationSetting,
  IntegrationKey,
  NotificationChannelSetting,
  NotificationRoute,
  SecurityPolicy,
  SettingsAdminAccount,
  SettingsAdminRole,
  SettingsPosition,
  SettingsUnit,
} from "@/types/admin-settings";
import { isRemoteServiceMode } from "@/lib/service-mode";
import { mockStorageKey } from "@/services/temp-storage";

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
};

export class AdminSettingsServiceError extends Error {
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, options?: { code?: string; details?: unknown }) {
    super(message);
    this.name = "AdminSettingsServiceError";
    this.code = options?.code;
    this.details = options?.details;
  }
}

const now = "2026-08-15T00:30:00.000Z";

export const defaultAdminSettingsSnapshot: AdminSettingsSnapshot = {
  units: [
    {
      id: "unit-1",
      code: "FLT-01-SQ-01",
      name: "一大队一中队",
      timezone: "Asia/Shanghai",
      contactName: "陈调度",
      contactEmail: "dispatch@example.com",
      contactPhone: "138****8000",
      active: true,
      adminCount: 4,
      pilotCount: 32,
      updatedAt: now,
      version: 1,
    },
    {
      id: "unit-2",
      code: "FLT-01-SQ-02",
      name: "一大队二中队",
      timezone: "Asia/Shanghai",
      contactName: "李调度",
      contactEmail: "dispatch2@example.com",
      contactPhone: "139****1200",
      active: true,
      adminCount: 3,
      pilotCount: 28,
      updatedAt: "2026-08-14T09:20:00.000Z",
      version: 1,
    },
    {
      id: "unit-3",
      code: "TRN-CENTER",
      name: "飞行训练中心",
      timezone: "Asia/Shanghai",
      contactName: "周教员",
      contactEmail: "training@example.com",
      contactPhone: "137****2600",
      active: false,
      adminCount: 1,
      pilotCount: 0,
      updatedAt: "2026-08-10T08:00:00.000Z",
      version: 1,
    },
  ],
  positions: [
    {
      id: "position-pilot",
      organizationId: "unit-1",
      code: "PILOT",
      name: "飞行员",
      description: "承担飞行运行与飞行员资质管理职责的成员。",
      active: true,
      sortOrder: 0,
      memberCount: 5,
      qualificationCount: 8,
      updatedAt: now,
      version: 1,
    },
    {
      id: "position-cabin-crew",
      organizationId: "unit-1",
      code: "CABIN_CREW",
      name: "乘务员",
      description: "负责客舱服务与运行安全的机组成员。",
      active: true,
      sortOrder: 1,
      memberCount: 0,
      qualificationCount: 0,
      updatedAt: now,
      version: 1,
    },
    {
      id: "position-maintenance",
      organizationId: "unit-1",
      code: "MAINTENANCE",
      name: "机务人员",
      description: "负责航空器维护与放行支持的专业人员。",
      active: false,
      sortOrder: 2,
      memberCount: 0,
      qualificationCount: 0,
      updatedAt: now,
      version: 1,
    },
  ],
  admins: [
    {
      id: "admin-1",
      displayName: "CrewQual 管理员",
      email: "admin@crewqual.local",
      unitId: null,
      unitName: "全局",
      role: "SUPER_ADMIN",
      active: true,
      totpStatus: "VERIFIED",
      lastLoginAt: now,
      activeSessionCount: 1,
    },
    {
      id: "admin-2",
      displayName: "王晨",
      email: "wangchen@example.com",
      unitId: "unit-1",
      unitName: "一大队一中队",
      role: "ADMIN",
      active: true,
      totpStatus: "VERIFIED",
      lastLoginAt: "2026-08-14T10:10:00.000Z",
      activeSessionCount: 2,
    },
    {
      id: "admin-3",
      displayName: "刘审核",
      email: "reviewer@example.com",
      unitId: "unit-1",
      unitName: "一大队一中队",
      role: "REVIEWER",
      active: true,
      totpStatus: "VERIFIED",
      lastLoginAt: "2026-08-14T04:25:00.000Z",
      activeSessionCount: 0,
    },
    {
      id: "admin-4",
      displayName: "赵观察",
      email: "viewer@example.com",
      unitId: "unit-2",
      unitName: "一大队二中队",
      role: "VIEWER",
      active: false,
      totpStatus: "PENDING_VERIFICATION",
      lastLoginAt: null,
      activeSessionCount: 0,
    },
  ],
  notificationChannels: [
    {
      key: "feishu",
      label: "飞书",
      enabled: true,
      status: "connected",
      endpoint: "https://open.feishu.cn/open-apis/bot/v2/hook/••••••••",
      secretConfigured: true,
      timeoutSeconds: 10,
      retryLimit: 3,
      lastTestAt: "2026-08-14T08:10:00.000Z",
      lastTestMessage: "连接正常",
      version: 1,
    },
    {
      key: "sms",
      label: "短信",
      enabled: false,
      status: "unconfigured",
      endpoint: "",
      secretConfigured: false,
      timeoutSeconds: 10,
      retryLimit: 3,
      lastTestAt: null,
      lastTestMessage: "尚未配置 Webhook",
      version: 1,
    },
    {
      key: "inApp",
      label: "站内通知",
      enabled: true,
      status: "connected",
      endpoint: "",
      secretConfigured: false,
      timeoutSeconds: 0,
      retryLimit: 0,
      lastTestAt: now,
      lastTestMessage: "系统内置渠道",
      version: 1,
    },
  ],
  notificationRoutes: [
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
  ],
  ai: {
    key: "vlm",
    enabled: true,
    status: "connected",
    endpoint: "http://localhost:8000/v1",
    model: "Qwen3.7-35B",
    secretConfigured: true,
    timeoutSeconds: 120,
    lastTestAt: "2026-08-14T08:12:00.000Z",
    lastTestMessage: "模型响应正常，结构化输出校验通过",
    version: 1,
  },
  security: {
    adminLoginMode: "PASSWORD_TOTP",
    adminSessionTtlHours: 8,
    pilotAccessLinkTtlMinutes: 15,
    pilotSessionTtlMinutes: 60,
    maxFailedAttempts: 5,
    lockoutMinutes: 15,
    version: 1,
  },
  sessions: [
    {
      id: "session-current",
      adminName: "CrewQual 管理员",
      browser: "Chrome · Windows",
      maskedIp: "192.168.***.12",
      createdAt: "2026-08-14T16:10:00.000Z",
      lastSeenAt: now,
      current: true,
    },
    {
      id: "session-2",
      adminName: "王晨",
      browser: "Edge · Windows",
      maskedIp: "10.20.***.48",
      createdAt: "2026-08-14T02:20:00.000Z",
      lastSeenAt: "2026-08-14T09:55:00.000Z",
      current: false,
    },
  ],
  audit: [
    {
      id: "audit-1",
      actor: "CrewQual 管理员",
      action: "更新 AI/OCR 配置",
      section: "ai",
      unitName: "全局",
      summary: "替换 API 密钥并完成连接测试；敏感值未写入审计",
      occurredAt: "2026-08-14T08:12:00.000Z",
    },
    {
      id: "audit-2",
      actor: "王晨",
      action: "更新通知路由",
      section: "notifications",
      unitName: "一大队一中队",
      summary: "审核退回增加短信渠道",
      occurredAt: "2026-08-14T07:40:00.000Z",
    },
    {
      id: "audit-3",
      actor: "CrewQual 管理员",
      action: "停用管理员账号",
      section: "admins",
      unitName: "一大队二中队",
      summary: "停用只读查看员赵观察并结束活跃会话",
      occurredAt: "2026-08-13T11:20:00.000Z",
    },
  ],
  systemHealth: [
    {
      key: "database",
      label: "数据库",
      status: "connected",
      detail: "PostgreSQL 连接正常",
      checkedAt: now,
    },
    {
      key: "storage",
      label: "对象存储",
      status: "connected",
      detail: "私有凭证桶可访问",
      checkedAt: now,
    },
    {
      key: "worker",
      label: "后台任务 Worker",
      status: "connected",
      detail: "最近心跳 1 分钟前",
      checkedAt: now,
    },
    {
      key: "queue",
      label: "通知队列",
      status: "connected",
      detail: "队列正常，无积压任务",
      checkedAt: now,
    },
  ],
};

export type UnitInput = Omit<SettingsUnit, "adminCount" | "pilotCount" | "updatedAt">;
export type PositionInput = Omit<
  SettingsPosition,
  "id" | "organizationId" | "memberCount" | "qualificationCount" | "updatedAt"
> & { id?: string; organizationId?: string };
export type DeletePositionInput = {
  id: string;
  version: number;
  force?: boolean;
};
export type DeletePositionResult = {
  id: string;
  forced: boolean;
};
export type AdminInput = Pick<
  SettingsAdminAccount,
  "id" | "displayName" | "email" | "unitId" | "role" | "active"
> & { temporaryPassword?: string };
export type AdminCredentialResult = SettingsAdminAccount & {
  /** Returned only by account provisioning/reset endpoints; never persisted in snapshots. */
  oneTimeTotpSecret?: string;
  oneTimeTotpUri?: string;
};
export type SecuritySaveResult = {
  policy: SecurityPolicy;
  reauthenticate: boolean;
};
export type SecuritySaveInput = SecurityPolicy & {
  currentPassword?: string;
  currentTotpCode?: string;
};
export type NotificationInput = {
  unitId: string;
  channels: NotificationChannelSetting[];
  routes: NotificationRoute[];
};
export type IntegrationInput =
  | ({ key: "vlm"; newSecret?: string } & AiIntegrationSetting)
  | ({ key: "feishu" | "sms"; newSecret?: string } & NotificationChannelSetting);

export type AdminAction = "disable" | "enable" | "resetPassword" | "resetTotp" | "revokeSessions";

export interface AdminSettingsService {
  load(unitId?: string): Promise<AdminSettingsSnapshot>;
  saveUnit(input: UnitInput): Promise<SettingsUnit>;
  createUnit(input: Omit<UnitInput, "id" | "version">): Promise<SettingsUnit>;
  listPositions(): Promise<SettingsPosition[]>;
  createPosition(input: Omit<PositionInput, "id" | "version">): Promise<SettingsPosition>;
  savePosition(input: PositionInput): Promise<SettingsPosition>;
  deletePosition(input: DeletePositionInput): Promise<DeletePositionResult>;
  saveAdmin(input: AdminInput): Promise<SettingsAdminAccount>;
  createAdmin(input: Omit<AdminInput, "id">): Promise<AdminCredentialResult>;
  runAdminAction(id: string, action: AdminAction, value?: string): Promise<AdminCredentialResult>;
  saveNotifications(input: NotificationInput): Promise<NotificationInput>;
  saveIntegration(
    input: IntegrationInput,
  ): Promise<NotificationChannelSetting | AiIntegrationSetting>;
  testIntegration(key: IntegrationKey): Promise<{ ok: boolean; message: string; testedAt: string }>;
  saveSecurity(input: SecuritySaveInput): Promise<SecuritySaveResult>;
  revokeSession(id: string): Promise<void>;
  loadMediaOptimization(): Promise<MediaOptimizationSetting>;
  saveMediaOptimization(input: MediaOptimizationSetting): Promise<MediaOptimizationSetting>;
}

export const adminSettingsStorageKey = "admin-settings:v1";
let memorySnapshot = structuredClone(defaultAdminSettingsSnapshot);

function readMockSnapshot() {
  if (typeof window === "undefined") return structuredClone(memorySnapshot);
  const raw = window.sessionStorage.getItem(mockStorageKey(adminSettingsStorageKey));
  if (!raw) return structuredClone(memorySnapshot);
  try {
    const parsed = JSON.parse(raw) as Partial<AdminSettingsSnapshot>;
    const legacySecurity = parsed.security as
      (Partial<SecurityPolicy> & { requireTotp?: boolean }) | undefined;
    const security = legacySecurity
      ? {
          ...structuredClone(defaultAdminSettingsSnapshot.security),
          ...legacySecurity,
          adminLoginMode:
            legacySecurity.adminLoginMode ??
            (legacySecurity.requireTotp === false ? "PASSWORD_ONLY" : "PASSWORD_TOTP"),
        }
      : structuredClone(defaultAdminSettingsSnapshot.security);
    const admins = parsed.admins
      ? parsed.admins.map((admin) => {
          const legacyAdmin = admin as SettingsAdminAccount & { totpEnabled?: boolean };
          return {
            ...admin,
            totpStatus:
              admin.totpStatus ?? (legacyAdmin.totpEnabled ? "VERIFIED" : "PENDING_VERIFICATION"),
          };
        })
      : structuredClone(defaultAdminSettingsSnapshot.admins);
    return {
      ...structuredClone(defaultAdminSettingsSnapshot),
      ...parsed,
      admins,
      security,
      positions: parsed.positions ?? structuredClone(defaultAdminSettingsSnapshot.positions),
    };
  } catch {
    window.sessionStorage.removeItem(mockStorageKey(adminSettingsStorageKey));
    return structuredClone(memorySnapshot);
  }
}

function writeMockSnapshot(snapshot: AdminSettingsSnapshot) {
  memorySnapshot = structuredClone(snapshot);
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(
      mockStorageKey(adminSettingsStorageKey),
      JSON.stringify(snapshot),
    );
  }
}

function mockUpdate(mutator: (snapshot: AdminSettingsSnapshot) => void) {
  const snapshot = readMockSnapshot();
  mutator(snapshot);
  writeMockSnapshot(snapshot);
  return snapshot;
}

const mockService: AdminSettingsService = {
  async load() {
    return readMockSnapshot();
  },
  async saveUnit(input) {
    let result!: SettingsUnit;
    mockUpdate((snapshot) => {
      const index = snapshot.units.findIndex((item) => item.id === input.id);
      if (index < 0) throw new Error("未找到单位");
      result = {
        ...snapshot.units[index]!,
        ...input,
        version: input.version + 1,
        updatedAt: new Date().toISOString(),
      };
      snapshot.units[index] = result;
    });
    return result;
  },
  async createUnit(input) {
    const result: SettingsUnit = {
      ...input,
      id: `unit-${Date.now().toString(36)}`,
      version: 1,
      adminCount: 0,
      pilotCount: 0,
      updatedAt: new Date().toISOString(),
    };
    mockUpdate((snapshot) => snapshot.units.push(result));
    return result;
  },
  async listPositions() {
    return readMockSnapshot().positions;
  },
  async createPosition(input) {
    const snapshot = readMockSnapshot();
    const organizationId = input.organizationId ?? "unit-1";
    if (
      snapshot.positions.some(
        (item) => item.organizationId === organizationId && item.code === input.code,
      )
    ) {
      throw new Error("职位编码已存在");
    }
    const result: SettingsPosition = {
      ...input,
      id: `position-${Date.now().toString(36)}`,
      organizationId,
      memberCount: 0,
      qualificationCount: 0,
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    mockUpdate((current) => current.positions.push(result));
    return result;
  },
  async savePosition(input) {
    let result!: SettingsPosition;
    mockUpdate((snapshot) => {
      const index = snapshot.positions.findIndex((item) => item.id === input.id);
      if (index < 0) throw new Error("未找到职位");
      const current = snapshot.positions[index]!;
      if (input.version !== current.version)
        throw new Error("职位已被其他管理员修改，请刷新后重试");
      if (input.code !== current.code) throw new Error("职位编码创建后不可修改");
      result = {
        ...current,
        ...input,
        id: current.id,
        organizationId: current.organizationId,
        updatedAt: new Date().toISOString(),
        version: current.version + 1,
      };
      snapshot.positions[index] = result;
    });
    return result;
  },
  async deletePosition(input) {
    let result!: DeletePositionResult;
    mockUpdate((snapshot) => {
      const index = snapshot.positions.findIndex((item) => item.id === input.id);
      if (index < 0) throw new AdminSettingsServiceError("未找到职位", { code: "NOT_FOUND" });
      const current = snapshot.positions[index]!;
      if (input.version !== current.version) {
        throw new AdminSettingsServiceError("职位已被其他管理员修改，请刷新后重试", {
          code: "VERSION_CONFLICT",
        });
      }
      const counts = {
        memberAssignments: current.memberCount,
        qualificationRequirements: current.qualificationCount,
        qualificationAssignments: current.qualificationCount,
        upgradePlans: 0,
      };
      if (!input.force && Object.values(counts).some((value) => value > 0)) {
        throw new AdminSettingsServiceError("职位存在历史关联，无法安全删除", {
          code: "POSITION_HAS_HISTORY",
          details: counts,
        });
      }
      snapshot.positions.splice(index, 1);
      result = { id: input.id, forced: Boolean(input.force) };
    });
    return result;
  },
  async saveAdmin(input) {
    let result!: SettingsAdminAccount;
    mockUpdate((snapshot) => {
      const index = snapshot.admins.findIndex((item) => item.id === input.id);
      if (index < 0) throw new Error("未找到管理员账号");
      const unit = snapshot.units.find((item) => item.id === input.unitId);
      result = { ...snapshot.admins[index]!, ...input, unitName: unit?.name ?? "全局" };
      snapshot.admins[index] = result;
    });
    return result;
  },
  async createAdmin(input) {
    let result!: SettingsAdminAccount;
    mockUpdate((snapshot) => {
      const unit = snapshot.units.find((item) => item.id === input.unitId);
      result = {
        ...input,
        id: `admin-${Date.now().toString(36)}`,
        unitName: unit?.name ?? "全局",
        totpStatus: "PENDING_VERIFICATION",
        lastLoginAt: null,
        activeSessionCount: 0,
      };
      snapshot.admins.push(result);
    });
    return result;
  },
  async runAdminAction(id, action) {
    let result!: SettingsAdminAccount;
    mockUpdate((snapshot) => {
      const index = snapshot.admins.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("未找到管理员账号");
      const current = snapshot.admins[index]!;
      result = {
        ...current,
        active: action === "disable" ? false : action === "enable" ? true : current.active,
        totpStatus: action === "resetTotp" ? "PENDING_VERIFICATION" : current.totpStatus,
        activeSessionCount: action === "revokeSessions" ? 0 : current.activeSessionCount,
      };
      snapshot.admins[index] = result;
    });
    return result;
  },
  async saveNotifications(input) {
    mockUpdate((snapshot) => {
      snapshot.notificationChannels = structuredClone(input.channels);
      snapshot.notificationRoutes = structuredClone(input.routes);
      snapshot.notificationUnitId = input.unitId;
    });
    return structuredClone(input);
  },
  async saveIntegration(input) {
    let result!: NotificationChannelSetting | AiIntegrationSetting;
    mockUpdate((snapshot) => {
      if (input.key === "vlm") {
        const { newSecret, ...values } = input;
        result = {
          ...values,
          secretConfigured: Boolean(newSecret) || values.secretConfigured,
          version: values.version + 1,
        };
        snapshot.ai = result as AiIntegrationSetting;
        return;
      }
      const { newSecret, ...values } = input;
      result = {
        ...values,
        secretConfigured: Boolean(newSecret) || values.secretConfigured,
        version: values.version + 1,
      };
      const index = snapshot.notificationChannels.findIndex((item) => item.key === input.key);
      if (index >= 0) snapshot.notificationChannels[index] = result as NotificationChannelSetting;
    });
    return result;
  },
  async testIntegration(key) {
    const snapshot = readMockSnapshot();
    const setting =
      key === "vlm" ? snapshot.ai : snapshot.notificationChannels.find((item) => item.key === key);
    const ok = Boolean(setting?.enabled && (key === "vlm" || setting?.endpoint));
    return {
      ok,
      message: ok ? "连接成功，服务响应正常" : "连接失败，请先启用并完成服务地址配置",
      testedAt: new Date().toISOString(),
    };
  },
  async saveSecurity(input) {
    const current = readMockSnapshot().security;
    const policyInput = { ...input };
    delete policyInput.currentPassword;
    delete policyInput.currentTotpCode;
    const result = { ...policyInput, version: input.version + 1 };
    mockUpdate((snapshot) => {
      snapshot.security = result;
    });
    return { policy: result, reauthenticate: current.adminLoginMode !== input.adminLoginMode };
  },
  async revokeSession(id) {
    mockUpdate((snapshot) => {
      snapshot.sessions = snapshot.sessions.filter((item) => item.id !== id);
    });
  },
  async loadMediaOptimization() {
    return { id: "global", enabled: false, idleMinutes: 5, batchSize: 5, version: 1 };
  },
  async saveMediaOptimization(input) {
    return { ...input, version: input.version + 1 };
  },
};

function readCsrfToken() {
  if (typeof document === "undefined") return "";
  const raw = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("crewqual_admin_session_csrf="));
  return raw ? decodeURIComponent(raw.slice("crewqual_admin_session_csrf=".length)) : "";
}

async function request<T>(method: string, body?: unknown, query = "") {
  const response = await fetch(`/api/admin/settings${query}`, {
    method,
    credentials: "include",
    cache: "no-store",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(!["GET", "HEAD"].includes(method) ? { "x-csrf-token": readCsrfToken() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || !payload.data) {
    throw new AdminSettingsServiceError(payload.error?.message ?? "系统设置请求失败", {
      code: payload.error?.code,
      details: payload.error?.details,
    });
  }
  return payload.data;
}

async function mediaRequest<T>(method: string, body?: unknown) {
  const response = await fetch("/api/admin/media-optimization", {
    method,
    credentials: "include",
    cache: "no-store",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(!["GET", "HEAD"].includes(method) ? { "x-csrf-token": readCsrfToken() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "图库优化请求失败");
  return payload.data;
}

const remoteService: AdminSettingsService = {
  load: (unitId) =>
    request<AdminSettingsSnapshot>(
      "GET",
      undefined,
      unitId ? `?unitId=${encodeURIComponent(unitId)}` : "",
    ),
  saveUnit: (input) => request("PATCH", { action: "unit.save", input }),
  createUnit: (input) => request("POST", { action: "unit.create", input }),
  listPositions: async () => (await request<AdminSettingsSnapshot>("GET")).positions,
  createPosition: (input) => request("POST", { action: "position.create", input }),
  savePosition: (input) => request("PATCH", { action: "position.save", input }),
  deletePosition: (input) => request("POST", { action: "position.delete", input }),
  saveAdmin: (input) => request("PATCH", { action: "admin.save", input }),
  createAdmin: (input) => request("POST", { action: "admin.create", input }),
  runAdminAction: (id, action, value) =>
    request("POST", { action: "admin.action", input: { id, action, value } }),
  saveNotifications: (input) => request("PATCH", { action: "notifications.save", input }),
  saveIntegration: (input) => request("PATCH", { action: "integration.save", input }),
  testIntegration: (key) => request("POST", { action: "integration.test", input: { key } }),
  saveSecurity: (input) => request("PATCH", { action: "security.save", input }),
  revokeSession: async (id) => {
    await request<{ revoked: boolean }>("POST", { action: "session.revoke", input: { id } });
  },
  loadMediaOptimization: () => mediaRequest<MediaOptimizationSetting>("GET"),
  saveMediaOptimization: (input) => mediaRequest<MediaOptimizationSetting>("PATCH", input),
};

const remoteMode = isRemoteServiceMode();

export const ADMIN_POSITIONS_CHANGED_EVENT = "crewqual:admin-positions-changed";

function announceAdminPositionsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ADMIN_POSITIONS_CHANGED_EVENT));
  }
}

const selectedService = remoteMode ? remoteService : mockService;

export const adminSettingsService: AdminSettingsService = {
  ...selectedService,
  async createPosition(input) {
    const result = await selectedService.createPosition(input);
    announceAdminPositionsChanged();
    return result;
  },
  async savePosition(input) {
    const result = await selectedService.savePosition(input);
    announceAdminPositionsChanged();
    return result;
  },
  async deletePosition(input) {
    const result = await selectedService.deletePosition(input);
    announceAdminPositionsChanged();
    return result;
  },
};

export const settingsRoleLabels: Record<SettingsAdminRole, string> = {
  SUPER_ADMIN: "超级管理员",
  ADMIN: "管理员",
  REVIEWER: "审核员",
  VIEWER: "只读查看员",
};
