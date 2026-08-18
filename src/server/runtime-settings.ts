import { getServerConfig } from "@/server/config";
import { decryptSettingSecret } from "@/server/crypto";
import { getPrisma } from "@/server/prisma";
import type { AdminLoginMode } from "@/types/admin-settings";

export type RuntimeSecurityPolicy = {
  adminLoginMode: AdminLoginMode;
  adminSessionTtlHours: number;
  pilotAccessLinkTtlMinutes: number;
  pilotSessionTtlMinutes: number;
  maxFailedAttempts: number;
  lockoutMinutes: number;
};

export type RuntimeIntegration = {
  enabled: boolean;
  endpoint: string;
  model: string;
  secret: string;
  timeoutSeconds: number;
  retryLimit: number;
  adapter: "disabled" | "fake" | "webhook" | "qwen";
};

function shouldReadDatabase() {
  const config = getServerConfig();
  return (
    config.SERVICE_MODE === "remote" && Boolean(config.DATABASE_URL) && config.NODE_ENV !== "test"
  );
}

export async function getRuntimeSecurityPolicy(): Promise<RuntimeSecurityPolicy> {
  const config = getServerConfig();
  const fallback: RuntimeSecurityPolicy = {
    adminLoginMode: "PASSWORD_TOTP",
    adminSessionTtlHours: config.ADMIN_SESSION_TTL_HOURS,
    pilotAccessLinkTtlMinutes: 15,
    pilotSessionTtlMinutes: config.PILOT_SESSION_TTL_MINUTES,
    maxFailedAttempts: 5,
    lockoutMinutes: 15,
  };
  if (!shouldReadDatabase()) return fallback;
  const policy = await getPrisma().securityPolicy.findUnique({ where: { id: "global" } });
  return policy
    ? {
        adminLoginMode: policy.adminLoginMode,
        adminSessionTtlHours: policy.adminSessionTtlHours,
        pilotAccessLinkTtlMinutes: policy.pilotAccessLinkTtlMinutes,
        pilotSessionTtlMinutes: policy.pilotSessionTtlMinutes,
        maxFailedAttempts: policy.maxFailedAttempts,
        lockoutMinutes: policy.lockoutMinutes,
      }
    : fallback;
}

export async function getRuntimeIntegration(
  key: "sms" | "feishu" | "vlm",
): Promise<RuntimeIntegration> {
  const config = getServerConfig();
  const fallback: RuntimeIntegration =
    key === "sms"
      ? {
          enabled: config.SMS_ADAPTER !== "disabled",
          endpoint: config.SMS_WEBHOOK_URL,
          model: "",
          secret: config.SMS_WEBHOOK_AUTH_TOKEN,
          timeoutSeconds: 10,
          retryLimit: 3,
          adapter: config.SMS_ADAPTER,
        }
      : key === "feishu"
        ? {
            enabled: config.FEISHU_ADAPTER !== "disabled",
            endpoint: config.FEISHU_WEBHOOK_URL,
            model: "",
            secret: config.FEISHU_WEBHOOK_AUTH_TOKEN,
            timeoutSeconds: 10,
            retryLimit: 3,
            adapter: config.FEISHU_ADAPTER,
          }
        : {
            enabled: config.VLM_ADAPTER !== "disabled",
            endpoint: config.QWEN_BASE_URL,
            model: config.QWEN_MODEL,
            secret: "",
            timeoutSeconds: 120,
            retryLimit: 0,
            adapter: config.VLM_ADAPTER,
          };
  if (!shouldReadDatabase()) return fallback;
  const setting = await getPrisma().systemIntegrationSetting.findUnique({ where: { key } });
  if (!setting) return fallback;
  return {
    enabled: setting.enabled,
    endpoint: setting.endpoint,
    model: setting.model,
    secret: setting.secretCiphertext ? decryptSettingSecret(setting.secretCiphertext) : "",
    timeoutSeconds: setting.timeoutSeconds,
    retryLimit: setting.retryLimit,
    adapter: setting.enabled ? (key === "vlm" ? "qwen" : "webhook") : "disabled",
  };
}
