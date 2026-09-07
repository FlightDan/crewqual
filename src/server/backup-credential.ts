import { z } from "zod";
import { ApiError } from "@/server/api-error";

export const BACKUP_TARGET_TYPES = ["LOCAL", "SMB", "FTP", "WEBDAV", "S3"] as const;
export type BackupTargetType = (typeof BACKUP_TARGET_TYPES)[number];
export type RemoteBackupTargetType = Exclude<BackupTargetType, "LOCAL">;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

const credentialValue = z
  .string()
  .max(8192)
  .refine((value) => !CONTROL_CHARACTER_PATTERN.test(value), {
    message: "凭据字段不能包含控制字符",
  });

const configCredentialValue = credentialValue.refine((value) => value.trim() === value, {
  message: "配置字段不能包含首尾空白字符",
});

const encryptionKey = { encryptionKey: credentialValue.optional() };

const smbCredentialSchema = z
  .object({
    username: configCredentialValue.optional(),
    password: credentialValue.optional(),
    ...encryptionKey,
  })
  .strict();

const ftpCredentialSchema = z
  .object({
    username: configCredentialValue.optional(),
    password: credentialValue.optional(),
    tls: z.enum(["true", "false"]).optional(),
    // rclone FTP always uses passive mode.  When supplied, the pinned proxy
    // permits only this server-advertised data-port range in addition to the
    // control port; an out-of-range PASV response fails closed.
    passivePortRange: configCredentialValue
      .regex(/^\d{1,5}-\d{1,5}$/, "被动 FTP 端口范围必须是 min-max")
      .refine((value) => {
        const [minimum, maximum] = value.split("-").map(Number);
        return minimum >= 1024 && maximum <= 65535 && minimum <= maximum;
      }, "被动 FTP 端口范围必须在 1024-65535 且最小端口不大于最大端口")
      .optional(),
    ...encryptionKey,
  })
  .strict();

const webdavCredentialSchema = z
  .object({
    username: configCredentialValue.optional(),
    password: credentialValue.optional(),
    ...encryptionKey,
  })
  .strict();

const s3CredentialSchema = z
  .object({
    accessKeyId: configCredentialValue.optional(),
    secretAccessKey: credentialValue.optional(),
    // Keep the legacy username/password spelling used by existing targets.
    username: configCredentialValue.optional(),
    password: credentialValue.optional(),
    ...encryptionKey,
  })
  .strict();

const genericCredentialSchema = z
  .object({
    accessKeyId: credentialValue.optional(),
    secretAccessKey: credentialValue.optional(),
    username: credentialValue.optional(),
    password: credentialValue.optional(),
    tls: credentialValue.optional(),
    ...encryptionKey,
  })
  .strict();

type SmbBackupCredentials = z.infer<typeof smbCredentialSchema>;
type FtpBackupCredentials = z.infer<typeof ftpCredentialSchema>;
type WebdavBackupCredentials = z.infer<typeof webdavCredentialSchema>;
type S3BackupCredentials = z.infer<typeof s3CredentialSchema>;

export type ParsedBackupCredentials =
  | { type: "LOCAL"; secret: string }
  | { type: "SMB"; values: SmbBackupCredentials }
  | { type: "FTP"; values: FtpBackupCredentials }
  | { type: "WEBDAV"; values: WebdavBackupCredentials }
  | { type: "S3"; values: S3BackupCredentials };

export type ParsedRemoteBackupCredentials = Exclude<ParsedBackupCredentials, { type: "LOCAL" }>;

export function backupArtifactEncryptionSecret(
  credentials: ParsedBackupCredentials,
  serializedSecret: string,
) {
  if (credentials.type === "LOCAL") return credentials.secret;
  // Legacy remote targets used the entire credential JSON as the artifact
  // passphrase. Keep that fallback so existing archives remain readable,
  // while new targets receive a stable key that survives credential rotation.
  return credentials.values.encryptionKey || serializedSecret;
}

export function serializeRemoteCredentialsWithEncryptionKey(
  credentials: ParsedRemoteBackupCredentials,
  generatedKey: string,
) {
  return JSON.stringify({
    ...credentials.values,
    encryptionKey: credentials.values.encryptionKey || generatedKey,
  });
}

function invalidCredential(message: string, fieldErrors?: Record<string, string[]>): never {
  throw new ApiError("INVALID_BACKUP_CREDENTIALS", message, 422, fieldErrors);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function parseCredentialJson<T extends z.ZodType>(secret: string, schema: T): z.infer<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secret);
  } catch {
    invalidCredential("备份目标密钥必须是 JSON", { secret: ["必须是合法 JSON"] });
  }

  if (!isPlainObject(parsed)) {
    invalidCredential("备份目标密钥 JSON 顶层必须是普通对象", {
      secret: ["顶层必须是非 null 普通对象"],
    });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const field = typeof issue.path[0] === "string" ? issue.path[0] : "secret";
      (fieldErrors[field] ??= []).push(issue.message);
    }
    const labels: Record<string, string> = {
      username: "用户名",
      password: "密码",
      accessKeyId: "访问密钥 ID",
      secretAccessKey: "访问密钥",
      tls: "TLS 配置",
      encryptionKey: "加密密钥",
    };
    const fields = Object.keys(fieldErrors)
      .map((field) => labels[field] ?? field)
      .join("、");
    invalidCredential(
      fields ? "备份目标凭据格式不合法：" + fields : "备份目标凭据格式不合法",
      fieldErrors,
    );
  }
  return result.data;
}

export function parseBackupCredentials(
  type: BackupTargetType,
  secret: string | undefined,
): ParsedBackupCredentials {
  if (type === "LOCAL") {
    const localSecret = secret ?? "";
    if (localSecret.length > 8192 || CONTROL_CHARACTER_PATTERN.test(localSecret)) {
      invalidCredential("本地备份加密密钥不能包含控制字符且长度不能超过 8192", {
        secret: ["包含控制字符或超过长度限制"],
      });
    }
    return { type, secret: localSecret };
  }

  if (!secret) {
    const empty = {};
    if (type === "SMB") return { type, values: smbCredentialSchema.parse(empty) };
    if (type === "FTP") return { type, values: ftpCredentialSchema.parse(empty) };
    if (type === "WEBDAV") return { type, values: webdavCredentialSchema.parse(empty) };
    return { type, values: s3CredentialSchema.parse(empty) };
  }

  if (secret.length > 8192) {
    invalidCredential("备份目标密钥长度不能超过 8192", { secret: ["长度不能超过 8192"] });
  }
  if (type === "SMB") return { type, values: parseCredentialJson(secret, smbCredentialSchema) };
  if (type === "FTP") return { type, values: parseCredentialJson(secret, ftpCredentialSchema) };
  if (type === "WEBDAV") {
    return { type, values: parseCredentialJson(secret, webdavCredentialSchema) };
  }
  return { type, values: parseCredentialJson(secret, s3CredentialSchema) };
}

/**
 * Setup predates the target-type-aware API and validates the credential JSON
 * before the target is persisted. Keep that compatibility entry point while
 * applying the same strict object and string-field rules.
 */
export function assertBackupCredentialJsonSafe(secret: string | undefined) {
  if (!secret) return;
  if (secret.length > 8192) {
    invalidCredential("备份目标密钥长度不能超过 8192", { secret: ["长度不能超过 8192"] });
  }
  parseCredentialJson(secret, genericCredentialSchema);
}
