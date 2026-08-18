export type SetupLocale = "zh-CN" | "en-US";

export type SetupEnvironmentStatus = "ok" | "warning" | "error" | "unknown";

export type SetupEnvironment = {
  database: SetupEnvironmentStatus;
  storage: SetupEnvironmentStatus;
  worker: SetupEnvironmentStatus;
  workerDetail: string;
  version: string;
};

export type SetupTemplate = {
  id: string;
  code: string;
  version: number;
  name: string;
  description: string;
  translations: Record<string, string>;
  positionCount: number;
  qualificationCount: number;
};

export type SetupOverview = {
  required: boolean;
  mode: "remote" | "mock";
  environment: SetupEnvironment;
  templates: SetupTemplate[];
  defaults: {
    locale: SetupLocale;
    timezone: string;
    organizationName: string;
    backupPath: string;
  };
};

export type SetupCompleteInput = {
  locale: SetupLocale;
  timezone: string;
  organizationName: string;
  admin: {
    displayName: string;
    email: string;
    password: string;
    requireTotp: boolean;
    verifiedTotpToken?: string;
  };
  templatePackIds: string[];
  backup: {
    enabled: boolean;
    targetName: string;
    targetType: "LOCAL" | "SMB" | "FTP" | "WEBDAV" | "S3";
    endpoint: string;
    basePath: string;
    secret?: string;
  };
  notifications: {
    inApp: boolean;
    feishu: {
      enabled: boolean;
      endpoint: string;
      secret?: string;
    };
    sms: {
      enabled: boolean;
      endpoint: string;
      secret?: string;
    };
    routes?: Array<{
      key: string;
      channels: Array<"inApp" | "feishu" | "sms">;
    }>;
  };
};

export type SetupCompleteResult = {
  completed: true;
  adminEmail: string;
  installedTemplateCount: number;
  installedPositionCount: number;
  backupEnabled: boolean;
  notificationChannels: string[];
};
