import { z } from "zod";
import { decryptSettingSecret, encryptSettingSecret } from "@/server/crypto";
import { getServerConfig, type ServerConfig } from "@/server/config";
import { assertSendEndpoint, checkExternalEndpoint } from "@/server/external-endpoint-safety";
import { getPrisma } from "@/server/prisma";

export type RuntimeStorageConfig = Pick<
  ServerConfig,
  | "S3_ENDPOINT"
  | "S3_REGION"
  | "S3_BUCKET"
  | "S3_ACCESS_KEY_ID"
  | "S3_SECRET_ACCESS_KEY"
  | "S3_SSE_KMS_KEY_ID"
  | "S3_FORCE_PATH_STYLE"
> & { mode: "builtin" | "s3" | "environment" };

export const setupStorageSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("builtin") }),
  z.object({
    mode: z.literal("s3"),
    endpoint: z.string().trim().url().max(2048),
    region: z.string().trim().min(1).max(128),
    bucket: z.string().trim().min(1).max(255),
    accessKeyId: z.string().trim().min(1).max(1024),
    secretAccessKey: z.string().min(8).max(8192),
    forcePathStyle: z.boolean(),
    sseKmsKeyId: z.string().trim().max(2048).optional(),
  }),
]);

export type SetupStorageInput = z.infer<typeof setupStorageSchema>;

type EncryptedCredentials = { accessKeyId: string; secretAccessKey: string };

function assertStorageEndpoint(config: RuntimeStorageConfig) {
  const serverConfig = getServerConfig();
  const check = checkExternalEndpoint(config.S3_ENDPOINT, serverConfig.NODE_ENV === "production", {
    allowedHosts: serverConfig.OUTBOUND_ALLOWED_HOSTS,
    allowedCidrs: serverConfig.OUTBOUND_ALLOWED_CIDRS,
    requireHostAllowlist: config.mode !== "builtin",
  });
  if (!check.ok) throw new Error(`对象存储地址被拒绝：${check.reason}`);
  return config;
}

export async function assertRuntimeStorageEndpoint(
  config: Pick<RuntimeStorageConfig, "S3_ENDPOINT"> & Partial<Pick<RuntimeStorageConfig, "mode">>,
  signal?: AbortSignal,
) {
  const serverConfig = getServerConfig();
  return assertSendEndpoint(config.S3_ENDPOINT, serverConfig.NODE_ENV === "production", {
    allowedHosts: serverConfig.OUTBOUND_ALLOWED_HOSTS,
    allowedCidrs: serverConfig.OUTBOUND_ALLOWED_CIDRS,
    requireHostAllowlist: config.mode !== "builtin",
    signal,
  });
}

function environmentStorageConfig(): RuntimeStorageConfig {
  const config = getServerConfig();
  return assertStorageEndpoint({
    mode: config.STORAGE_MODE === "builtin" ? "builtin" : "environment",
    S3_ENDPOINT: config.S3_ENDPOINT,
    S3_REGION: config.S3_REGION,
    S3_BUCKET: config.S3_BUCKET,
    S3_ACCESS_KEY_ID: config.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: config.S3_SECRET_ACCESS_KEY,
    S3_SSE_KMS_KEY_ID: config.S3_SSE_KMS_KEY_ID,
    S3_FORCE_PATH_STYLE: config.S3_FORCE_PATH_STYLE,
  });
}

function decodeCredentials(ciphertext: string | null): EncryptedCredentials {
  if (!ciphertext) return { accessKeyId: "", secretAccessKey: "" };
  const parsed = z
    .object({ accessKeyId: z.string(), secretAccessKey: z.string() })
    .parse(JSON.parse(decryptSettingSecret(ciphertext)));
  return parsed;
}

export async function getRuntimeStorageConfig(): Promise<RuntimeStorageConfig> {
  const fallback = environmentStorageConfig();
  const config = getServerConfig();
  if (config.SERVICE_MODE !== "remote" || !config.DATABASE_URL || config.NODE_ENV === "test") {
    return fallback;
  }
  const setting = await getPrisma().objectStorageSetting.findUnique({ where: { id: "global" } });
  if (!setting || setting.provider === "BUILTIN") return fallback;
  const credentials = decodeCredentials(setting.credentialsCiphertext);
  return assertStorageEndpoint({
    mode: "s3",
    S3_ENDPOINT: setting.endpoint,
    S3_REGION: setting.region,
    S3_BUCKET: setting.bucket,
    S3_ACCESS_KEY_ID: credentials.accessKeyId,
    S3_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    S3_SSE_KMS_KEY_ID: setting.sseKmsKeyId,
    S3_FORCE_PATH_STYLE: setting.forcePathStyle,
  });
}

export function resolveSetupStorage(input: SetupStorageInput): RuntimeStorageConfig {
  const parsed = setupStorageSchema.parse(input);
  if (parsed.mode === "builtin") return environmentStorageConfig();
  const endpoint = new URL(parsed.endpoint);
  if (endpoint.username || endpoint.password) {
    throw new Error("S3 endpoint must not contain embedded credentials");
  }
  return assertStorageEndpoint({
    mode: "s3",
    S3_ENDPOINT: endpoint.toString().replace(/\/$/, ""),
    S3_REGION: parsed.region,
    S3_BUCKET: parsed.bucket,
    S3_ACCESS_KEY_ID: parsed.accessKeyId,
    S3_SECRET_ACCESS_KEY: parsed.secretAccessKey,
    S3_SSE_KMS_KEY_ID: parsed.sseKmsKeyId ?? "",
    S3_FORCE_PATH_STYLE: parsed.forcePathStyle,
  });
}

export function storageSettingData(input: SetupStorageInput) {
  const parsed = setupStorageSchema.parse(input);
  if (parsed.mode === "builtin") {
    return {
      provider: "BUILTIN" as const,
      endpoint: "",
      region: "us-east-1",
      bucket: "",
      credentialsCiphertext: null,
      forcePathStyle: true,
      sseKmsKeyId: "",
    };
  }
  return {
    provider: "S3" as const,
    endpoint: new URL(parsed.endpoint).toString().replace(/\/$/, ""),
    region: parsed.region,
    bucket: parsed.bucket,
    credentialsCiphertext: encryptSettingSecret(
      JSON.stringify({
        accessKeyId: parsed.accessKeyId,
        secretAccessKey: parsed.secretAccessKey,
      } satisfies EncryptedCredentials),
    ),
    forcePathStyle: parsed.forcePathStyle,
    sseKmsKeyId: parsed.sseKmsKeyId ?? "",
  };
}

export function storageLocationChanged(
  current: Pick<RuntimeStorageConfig, "S3_ENDPOINT" | "S3_BUCKET">,
  next: Pick<RuntimeStorageConfig, "S3_ENDPOINT" | "S3_BUCKET">,
) {
  const currentEndpoint = new URL(current.S3_ENDPOINT).toString().replace(/\/$/, "");
  const nextEndpoint = new URL(next.S3_ENDPOINT).toString().replace(/\/$/, "");
  return currentEndpoint !== nextEndpoint || current.S3_BUCKET !== next.S3_BUCKET;
}
