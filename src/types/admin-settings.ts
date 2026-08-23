export type SettingsSectionId =
  | "organization"
  | "positions"
  | "admins"
  | "notifications"
  | "ai"
  | "security"
  | "storage"
  | "media"
  | "backups"
  | "updates";

export type MediaOptimizationSetting = {
  id: "global";
  enabled: boolean;
  idleMinutes: number;
  batchSize: number;
  version: number;
};

export type BackupTargetSetting = {
  id: string;
  name: string;
  type: "LOCAL" | "SMB" | "FTP" | "WEBDAV" | "S3";
  endpoint: string;
  basePath: string;
  encryptionEnabled: boolean;
  active: boolean;
  secretConfigured: boolean;
  lastTestedAt: string | null;
  lastTestMessage: string;
  version: number;
};
export type BackupPlanSetting = {
  id: string;
  name: string;
  source: "GALLERY" | "DATABASE";
  mode: "FULL" | "INCREMENTAL";
  cron: string;
  timezone: string;
  retentionCount: number;
  retentionDays: number;
  enabled: boolean;
  version: number;
  targetId: string;
  targetName: string;
  lastSuccessfulAt: string | null;
};
export type BackupRunSetting = {
  id: string;
  planId: string;
  planName: string;
  source: "GALLERY" | "DATABASE";
  mode: "FULL" | "INCREMENTAL";
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  startedAt: string | null;
  completedAt: string | null;
  bytesWritten: number;
  artifactPath: string | null;
  errorMessage: string | null;
  createdAt: string;
};
export type BackupSettingsSnapshot = {
  targets: BackupTargetSetting[];
  plans: BackupPlanSetting[];
  runs: BackupRunSetting[];
};

export type SettingsUnit = {
  id: string;
  organizationId: string | null;
  defaultLocale: SupportedLocale;
  organizationVersion: number;
  code: string;
  name: string;
  timezone: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  active: boolean;
  adminCount: number;
  pilotCount: number;
  updatedAt: string;
  version: number;
};

export type SettingsPosition = {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  description: string;
  active: boolean;
  sortOrder: number;
  memberCount: number;
  qualificationCount: number;
  updatedAt: string;
  version: number;
};

export type SettingsAdminRole = "SUPER_ADMIN" | "ADMIN" | "REVIEWER" | "VIEWER";

export type AdminLoginMode = "PASSWORD_TOTP" | "TOTP_ONLY" | "PASSWORD_ONLY";

export type SettingsAdminAccount = {
  id: string;
  displayName: string;
  email: string;
  unitId: string | null;
  unitName: string;
  role: SettingsAdminRole;
  active: boolean;
  totpStatus: "PENDING_VERIFICATION" | "VERIFIED";
  lastLoginAt: string | null;
  activeSessionCount: number;
};

export type NotificationChannelKey = "feishu" | "sms" | "inApp";
export type IntegrationKey = "feishu" | "sms" | "vlm";
export type ConnectionStatus = "connected" | "error" | "unconfigured";

export type NotificationChannelSetting = {
  key: NotificationChannelKey;
  label: string;
  enabled: boolean;
  status: ConnectionStatus;
  endpoint: string;
  secretConfigured: boolean;
  timeoutSeconds: number;
  retryLimit: number;
  lastTestAt: string | null;
  lastTestMessage: string;
  version: number;
};

export type NotificationRoute = {
  key: string;
  label: string;
  description: string;
  channels: NotificationChannelKey[];
};

export type AiIntegrationSetting = {
  key: "vlm";
  enabled: boolean;
  status: ConnectionStatus;
  endpoint: string;
  model: string;
  secretConfigured: boolean;
  timeoutSeconds: number;
  lastTestAt: string | null;
  lastTestMessage: string;
  version: number;
};

export type SecurityPolicy = {
  networkMode: "lan" | "http" | "tls";
  appOrigin: string;
  appPort: number;
  adminLoginMode: AdminLoginMode;
  adminSessionTtlHours: number;
  pilotAccessLinkTtlMinutes: number;
  pilotSessionTtlMinutes: number;
  maxFailedAttempts: number;
  lockoutMinutes: number;
  allowPublicAccess: boolean;
  version: number;
};

export type SettingsSession = {
  id: string;
  adminName: string;
  browser: string;
  maskedIp: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

export type SettingsAuditItem = {
  id: string;
  actor: string;
  action: string;
  section: SettingsSectionId;
  unitName: string;
  summary: string;
  occurredAt: string;
};

export type SystemHealthItem = {
  key: "database" | "storage" | "worker" | "queue";
  label: string;
  status: ConnectionStatus;
  detail: string;
  checkedAt: string;
};

export type AdminSettingsSnapshot = {
  units: SettingsUnit[];
  positions: SettingsPosition[];
  admins: SettingsAdminAccount[];
  notificationChannels: NotificationChannelSetting[];
  notificationRoutes: NotificationRoute[];
  notificationUnitId?: string | null;
  ai: AiIntegrationSetting;
  security: SecurityPolicy;
  sessions: SettingsSession[];
  audit: SettingsAuditItem[];
  systemHealth: SystemHealthItem[];
};
import type { SupportedLocale } from "@/lib/locale";
