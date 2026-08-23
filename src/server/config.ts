import { z } from "zod";

const booleanFromEnv = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");
const optionalUrl = z.union([z.string().url(), z.literal("")]).default("");
const networkMode = z.enum(["lan", "http", "tls"]).default("tls");

const serverConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SERVICE_MODE: z.enum(["remote", "mock"]).default("remote"),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  APP_DOMAIN: z.string().default("localhost"),
  TLS_EMAIL: z.string().default("crewqual-local@lan.invalid"),
  DEPLOYMENT_NETWORK_MODE: networkMode,
  APP_PORT: z.coerce.number().int().min(1).max(65535).default(443),
  CADDY_SITE_ADDRESS: z.string().default("localhost"),
  APP_BIND: z.string().default("0.0.0.0"),
  ACME_BIND: z.string().default("127.0.0.1"),
  ACME_PORT: z.coerce.number().int().min(1).max(65535).default(18080),
  NETWORK_ACCESS_SECRET: z.string().default(""),
  SETUP_AUTH_CODE_HASH: z.string().default(""),
  DATABASE_URL: z.string().default(""),
  DIRECT_URL: z.string().default(""),
  SESSION_SECRET: z.string().min(32).default("development-only-crewqual-session-secret-32"),
  SETTINGS_ENCRYPTION_KEY: z.string().default(""),
  PILOT_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(8),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  STORAGE_MODE: z.enum(["builtin", "external"]).default("external"),
  S3_ENDPOINT: z.string().url().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1).default("crewqual-private"),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  S3_SSE_KMS_KEY_ID: z.string().default(""),
  S3_FORCE_PATH_STYLE: booleanFromEnv,
  QWEN_BASE_URL: z.string().url().default("http://localhost:8000/v1"),
  QWEN_MODEL: z.string().default("Qwen3.7-35B"),
  SMS_ADAPTER: z.enum(["disabled", "fake", "webhook"]).default("disabled"),
  SMS_WEBHOOK_URL: optionalUrl,
  SMS_WEBHOOK_AUTH_TOKEN: z.string().default(""),
  SMS_RECEIPT_WEBHOOK_SECRET: z.string().default(""),
  FEISHU_ADAPTER: z.enum(["disabled", "webhook"]).default("disabled"),
  FEISHU_WEBHOOK_URL: optionalUrl,
  FEISHU_WEBHOOK_AUTH_TOKEN: z.string().default(""),
  VLM_ADAPTER: z.enum(["disabled", "qwen"]).default("disabled"),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

let cachedConfig: ServerConfig | null = null;

export function getServerConfig(): ServerConfig {
  if (cachedConfig) return cachedConfig;
  const parsed = serverConfigSchema.safeParse({
    ...process.env,
    SERVICE_MODE:
      process.env.SERVICE_MODE ??
      process.env.NEXT_PUBLIC_SERVICE_MODE ??
      (process.env.NODE_ENV === "production" ? "remote" : "mock"),
  });
  if (!parsed.success) {
    throw new Error(`Invalid server configuration: ${parsed.error.message}`);
  }
  if (parsed.data.NODE_ENV === "production") {
    const required = [
      ["DATABASE_URL", parsed.data.DATABASE_URL],
      ["SESSION_SECRET", process.env.SESSION_SECRET],
      ["S3_ACCESS_KEY_ID", parsed.data.S3_ACCESS_KEY_ID],
      ["S3_SECRET_ACCESS_KEY", parsed.data.S3_SECRET_ACCESS_KEY],
      ...(process.env.NEXT_PHASE === "phase-production-build"
        ? []
        : [["SETTINGS_ENCRYPTION_KEY", parsed.data.SETTINGS_ENCRYPTION_KEY] as const]),
    ] as const;
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error(`Missing production configuration: ${missing.join(", ")}`);
    const appOrigin = new URL(parsed.data.APP_ORIGIN);
    const isPrivateHttpOrigin =
      appOrigin.protocol === "http:" &&
      parsed.data.DEPLOYMENT_NETWORK_MODE === "lan" &&
      (appOrigin.hostname === "localhost" ||
        appOrigin.hostname === "127.0.0.1" ||
        /^10\./.test(appOrigin.hostname) ||
        /^192\.168\./.test(appOrigin.hostname) ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(appOrigin.hostname));
    const isPublicHttpOrigin =
      appOrigin.protocol === "http:" && parsed.data.DEPLOYMENT_NETWORK_MODE === "http";
    const isTlsOrigin =
      appOrigin.protocol === "https:" && parsed.data.DEPLOYMENT_NETWORK_MODE === "tls";
    if (
      (!isPrivateHttpOrigin && !isPublicHttpOrigin && !isTlsOrigin) ||
      parsed.data.APP_ORIGIN !== appOrigin.origin
    ) {
      throw new Error(
        "Production APP_ORIGIN must be an exact HTTPS origin, a private HTTP origin in LAN mode, or an HTTP origin in public HTTP mode",
      );
    }
    if (parsed.data.SESSION_SECRET.length < 48) {
      throw new Error("Production SESSION_SECRET must contain at least 48 characters");
    }
    if (
      parsed.data.SETTINGS_ENCRYPTION_KEY.length < 32 ||
      parsed.data.SETTINGS_ENCRYPTION_KEY === parsed.data.SESSION_SECRET
    ) {
      throw new Error(
        "Production SETTINGS_ENCRYPTION_KEY must be at least 32 characters and distinct from SESSION_SECRET",
      );
    }
    if (
      parsed.data.S3_SECRET_ACCESS_KEY.length < 16 ||
      parsed.data.S3_SECRET_ACCESS_KEY === "crewqual-secret"
    ) {
      throw new Error("Production S3_SECRET_ACCESS_KEY must be a non-default secret");
    }
    const storageEndpoint = new URL(parsed.data.S3_ENDPOINT);
    const trustedBuiltinEndpoint =
      parsed.data.STORAGE_MODE === "builtin" &&
      storageEndpoint.protocol === "http:" &&
      storageEndpoint.hostname === "minio" &&
      storageEndpoint.port === "9000";
    if (storageEndpoint.protocol !== "https:" && !trustedBuiltinEndpoint) {
      throw new Error("Production S3_ENDPOINT must use HTTPS");
    }
    if (parsed.data.SERVICE_MODE === "mock") {
      throw new Error("Mock service mode is not allowed in production");
    }
    if (parsed.data.SMS_ADAPTER === "webhook" && !parsed.data.SMS_WEBHOOK_URL) {
      throw new Error("SMS_WEBHOOK_URL is required for the webhook SMS adapter");
    }
  }
  cachedConfig = parsed.data;
  return cachedConfig;
}

export function resetServerConfigForTests() {
  cachedConfig = null;
}
