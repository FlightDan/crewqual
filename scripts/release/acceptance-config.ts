import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { activeKey, parseKeyringJSON, type KeyringDocument } from "./keyring-utils";

export type AcceptanceScope = "local" | "isolated" | "full";
export type ReleaseProfile = "rc" | "final";
type AcceptanceEnvironment = Readonly<Record<string, string | undefined>>;

export const RELEASE_SANDBOX_INFRASTRUCTURE_SECRETS = [
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "S3_ENDPOINT",
  "EVIDENCE_S3_BUCKET",
  "BACKUP_S3_BUCKET",
  "RESTORE_S3_BUCKET",
  "S3_KMS_KEY_ARN",
  "S3_FORBIDDEN_PREFIX",
  "BACKUP_RECOVERY_SET_ID",
  "BACKUP_DATABASE_RUN_ID",
  "BACKUP_GALLERY_RUN_ID",
  "BACKUP_TAMPER_ARTIFACT_KEYS",
  "BACKUP_TAMPER_BLOB_SHA256",
  "RESTORE_DATABASE_URL",
  "DATABASE_URL",
] as const;

const COMMON_RELEASE_SECRETS = [
  "UPDATE_MANIFEST_PRIVATE_KEY_B64",
  "UPDATE_MANIFEST_SIGNING_KEY_ID",
  "RELEASE_TAG_SIGNING_PUBLIC_KEY_B64",
  "RELEASE_SIGNER_FINGERPRINTS",
] as const;

function value(environment: AcceptanceEnvironment, name: string) {
  return environment[name]?.trim() ?? "";
}

function parseUrl(raw: string, name: string, protocols: string[], issues: string[]) {
  try {
    const parsed = new URL(raw);
    if (!protocols.includes(parsed.protocol)) {
      issues.push(`${name} 必须使用 ${protocols.join(" 或 ")}`);
    }
    return parsed;
  } catch {
    issues.push(`${name} 必须是有效 URL`);
    return undefined;
  }
}

function databaseIdentity(parsed: URL, name: string, issues: string[]) {
  let database = "";
  try {
    database = decodeURIComponent(parsed.pathname).replace(/^\/+|\/+$/g, "");
  } catch {
    issues.push(`${name} 的数据库名包含无效 URL 编码`);
    return undefined;
  }
  if (!parsed.hostname || !database) {
    issues.push(`${name} 必须包含数据库主机和数据库名`);
    return undefined;
  }
  return `${parsed.hostname.toLowerCase()}:${parsed.port || "5432"}/${database}`;
}

function releaseKeyring() {
  return parseKeyringJSON(
    readFileSync(new URL("../../security/update-manifest-keyring.json", import.meta.url), "utf8"),
    { requireActive: true },
  );
}

function validateSigningConfiguration(
  environment: AcceptanceEnvironment,
  issues: string[],
  configuredKeyring?: KeyringDocument,
) {
  const fingerprints = value(environment, "RELEASE_SIGNER_FINGERPRINTS")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    value(environment, "RELEASE_SIGNER_FINGERPRINTS") &&
    (!fingerprints.length || fingerprints.some((item) => !/^[A-Fa-f0-9]{40}$/.test(item)))
  ) {
    issues.push("RELEASE_SIGNER_FINGERPRINTS 必须是逗号分隔的 40 位十六进制指纹");
  }

  const privateKey = value(environment, "UPDATE_MANIFEST_PRIVATE_KEY_B64");
  let parsedPrivateKey: KeyObject | undefined;
  if (privateKey) {
    try {
      parsedPrivateKey = createPrivateKey({
        key: Buffer.from(privateKey, "base64"),
        format: "der",
        type: "pkcs8",
      });
      if (parsedPrivateKey.asymmetricKeyType !== "ed25519") {
        issues.push("UPDATE_MANIFEST_PRIVATE_KEY_B64 必须是 Ed25519 PKCS#8 私钥");
        parsedPrivateKey = undefined;
      }
    } catch {
      issues.push("UPDATE_MANIFEST_PRIVATE_KEY_B64 必须是有效的 base64 PKCS#8 私钥");
    }
  }

  try {
    const keyringEntry = activeKey(configuredKeyring ?? releaseKeyring());
    const signingKeyId = value(environment, "UPDATE_MANIFEST_SIGNING_KEY_ID");
    if (signingKeyId && signingKeyId !== keyringEntry.id) {
      issues.push("UPDATE_MANIFEST_SIGNING_KEY_ID 必须匹配 manifest keyring 的 active key");
    }
    if (parsedPrivateKey) {
      const publicKey = createPublicKey(parsedPrivateKey)
        .export({ format: "der", type: "spki" })
        .subarray(-32)
        .toString("base64");
      if (publicKey !== keyringEntry.publicKey) {
        issues.push("UPDATE_MANIFEST_PRIVATE_KEY_B64 必须匹配 manifest keyring 的 active key");
      }
    }
  } catch (error) {
    issues.push(`manifest keyring 无效：${error instanceof Error ? error.message : String(error)}`);
  }

  const tagPublicKey = value(environment, "RELEASE_TAG_SIGNING_PUBLIC_KEY_B64");
  if (tagPublicKey) {
    const decoded = Buffer.from(tagPublicKey, "base64").toString("utf8");
    if (!decoded.includes("BEGIN PGP PUBLIC KEY BLOCK")) {
      issues.push("RELEASE_TAG_SIGNING_PUBLIC_KEY_B64 必须包含 base64 编码的 OpenPGP 公钥");
    }
  }
}

function validateFullConfiguration(environment: AcceptanceEnvironment, issues: string[]) {
  const endpoint = value(environment, "S3_ENDPOINT");
  if (endpoint) {
    const parsed = parseUrl(endpoint, "S3_ENDPOINT", ["https:"], issues);
    if (parsed?.username || parsed?.password) issues.push("S3_ENDPOINT 不得内嵌凭据");
  }

  const databaseUrl = value(environment, "DATABASE_URL");
  const restoreDatabaseUrl = value(environment, "RESTORE_DATABASE_URL");
  const database = databaseUrl
    ? parseUrl(databaseUrl, "DATABASE_URL", ["postgres:", "postgresql:"], issues)
    : undefined;
  const restoreDatabase = restoreDatabaseUrl
    ? parseUrl(restoreDatabaseUrl, "RESTORE_DATABASE_URL", ["postgres:", "postgresql:"], issues)
    : undefined;
  const sourceIdentity = database ? databaseIdentity(database, "DATABASE_URL", issues) : undefined;
  const restoreIdentity = restoreDatabase
    ? databaseIdentity(restoreDatabase, "RESTORE_DATABASE_URL", issues)
    : undefined;
  if (sourceIdentity && restoreIdentity && sourceIdentity === restoreIdentity) {
    issues.push("RESTORE_DATABASE_URL 不得指向在线 DATABASE_URL 的同一数据库");
  }

  const buckets = ["EVIDENCE_S3_BUCKET", "BACKUP_S3_BUCKET", "RESTORE_S3_BUCKET"] as const;
  const configuredBuckets = buckets.map((name) => value(environment, name)).filter(Boolean);
  if (new Set(configuredBuckets).size !== configuredBuckets.length) {
    issues.push("EVIDENCE_S3_BUCKET、BACKUP_S3_BUCKET 和 RESTORE_S3_BUCKET 必须彼此隔离");
  }

  const tamperKeysRaw = value(environment, "BACKUP_TAMPER_ARTIFACT_KEYS");
  if (tamperKeysRaw) {
    try {
      const parsed = JSON.parse(tamperKeysRaw) as Record<string, unknown>;
      const invalid = ["database", "gallery", "blob"].filter(
        (name) => typeof parsed[name] !== "string" || !String(parsed[name]).trim(),
      );
      if (invalid.length) {
        issues.push(`BACKUP_TAMPER_ARTIFACT_KEYS 缺少非空字段：${invalid.join(", ")}`);
      }
    } catch {
      issues.push("BACKUP_TAMPER_ARTIFACT_KEYS 必须是有效 JSON 对象");
    }
  }

  const blobSha256 = value(environment, "BACKUP_TAMPER_BLOB_SHA256");
  if (blobSha256 && !/^[A-Fa-f0-9]{64}$/.test(blobSha256)) {
    issues.push("BACKUP_TAMPER_BLOB_SHA256 必须是 64 位十六进制 SHA-256");
  }
}

export function acceptanceInputIssues(
  environment: AcceptanceEnvironment,
  options: { scope: AcceptanceScope; profile: ReleaseProfile },
): string[] {
  if (environment.RELEASE_UPGRADE_FROM_TAG === undefined) {
    return ["RELEASE_UPGRADE_FROM_TAG 必须显式设置；空值表示 fresh install"];
  }
  const result = spawnSync(
    "bash",
    [
      path.join(path.dirname(fileURLToPath(import.meta.url)), "validate-release-inputs.sh"),
      environment.RELEASE_TAG ?? "",
      options.profile,
      options.scope,
      environment.RELEASE_UPGRADE_FROM_TAG,
      environment.RELEASE_ARM64_BOOTSTRAP_FROM_TAG ?? "",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.error) return [`release input validator failed: ${result.error.message}`];
  return result.status === 0 ? [] : [result.stderr.trim() || "release inputs invalid"];
}

export function acceptanceConfigIssues(
  environment: AcceptanceEnvironment,
  options: {
    scope: AcceptanceScope;
    profile: ReleaseProfile;
    keyring?: KeyringDocument;
  },
) {
  const issues = acceptanceInputIssues(environment, options);
  if (issues.length) return issues;
  const requiredNames = [
    ...COMMON_RELEASE_SECRETS,
    ...(options.scope === "full" ? RELEASE_SANDBOX_INFRASTRUCTURE_SECRETS : []),
    ...(options.profile === "final" ? (["LICENSE_APPROVALS_JSON"] as const) : []),
  ];
  const missing = requiredNames.filter((name) => !value(environment, name));
  if (missing.length) issues.push(`缺少必需的发布配置：${missing.join(", ")}`);

  validateSigningConfiguration(environment, issues, options.keyring);
  if (options.scope === "full") validateFullConfiguration(environment, issues);

  const approvals = value(environment, "LICENSE_APPROVALS_JSON");
  if (approvals) {
    try {
      const parsed = JSON.parse(approvals) as { licenses?: unknown };
      if (
        !Array.isArray(parsed.licenses) ||
        parsed.licenses.some((license) => typeof license !== "string" || !license.trim())
      ) {
        issues.push("LICENSE_APPROVALS_JSON 必须包含非空字符串组成的 licenses 数组");
      }
    } catch {
      issues.push("LICENSE_APPROVALS_JSON 必须是有效 JSON 对象");
    }
  }
  return issues;
}

export function assertAcceptanceConfig(
  environment: AcceptanceEnvironment,
  options: {
    scope: AcceptanceScope;
    profile: ReleaseProfile;
    keyring?: KeyringDocument;
  },
) {
  const issues = acceptanceConfigIssues(environment, options);
  if (issues.length) {
    throw new Error(`发布验收配置预检失败：\n- ${issues.join("\n- ")}`);
  }
}

async function main() {
  const scope = (process.env.RELEASE_ACCEPTANCE_SCOPE ?? "local") as AcceptanceScope;
  const profile = (process.env.RELEASE_PROFILE ?? "rc") as ReleaseProfile;
  if (!(["local", "isolated", "full"] as const).includes(scope))
    throw new Error(`无效 acceptance scope：${scope}`);
  if (!(["rc", "final"] as const).includes(profile))
    throw new Error(`无效 release profile：${profile}`);
  assertAcceptanceConfig(process.env, { scope, profile });
  console.log(JSON.stringify({ event: "release_acceptance_config_valid", scope, profile }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "release_acceptance_config_invalid",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 3;
  });
}
