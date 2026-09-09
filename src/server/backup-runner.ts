import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createServer, request as proxyHttpRequest } from "node:http";
import { request as proxyHttpsRequest } from "node:https";
import { connect as connectSocket, isIP } from "node:net";
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getServerConfig } from "@/server/config";
import { decryptSettingSecret } from "@/server/crypto";
import { getPrisma } from "@/server/prisma";
import { putPrivateObjectAtKey, readPrivateEvidence } from "@/server/storage";
import {
  finalizeRestoredEvidence,
  prepareRestoredEvidence,
  resetRestoredEvidenceTrust,
  type RebuiltRestoreObject,
} from "@/server/evidence-restore";
import { EVIDENCE_STORAGE_ENCODING_VERSION } from "@/server/evidence-provenance";
import { getRuntimeStorageConfig, type RuntimeStorageConfig } from "@/server/runtime-storage";
import { createPinnedS3Client } from "@/server/s3-client";
import {
  backupArtifactEncryptionSecret,
  parseBackupCredentials,
  type BackupTargetType,
  type ParsedBackupCredentials,
  type ParsedRemoteBackupCredentials,
} from "@/server/backup-credential";
import { assertBackupEndpointResolved } from "@/server/backup-endpoint-safety";
import { prepareLocalBackupDirectory } from "@/server/backup-path";
import type { ResolvedExternalEndpoint } from "@/server/external-endpoint-safety";
import {
  minimalSubprocessEnvironment,
  postgresEnvironmentFromUrl,
} from "@/server/postgres-client-environment";
export { assertBackupCredentialJsonSafe } from "@/server/backup-credential";

const execFileAsync = promisify(execFile);
const BACKUP_RUN_STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const MAX_TAR_LISTING_BYTES = 64 * 1024 * 1024;

type RestoreRunArtifact = {
  id: string;
  mode: "FULL" | "INCREMENTAL";
  artifactPath: string | null;
  manifestSha256: string | null;
};

function databaseIdentity(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("数据库连接地址无效，拒绝恢复");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("数据库连接地址必须使用 PostgreSQL 协议");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const port = url.port || "5432";
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const socketHost = url.searchParams.get("host") ?? "";
  const service = url.searchParams.get("service") ?? "";
  return `${hostname}:${port}/${database}?host=${socketHost}&service=${service}`;
}

type PostgresIdentity = {
  databaseName: string;
  databaseOid: string | null;
  serverAddress: string | null;
  serverPort: number | null;
  dataDirectory: string | null;
  systemIdentifier: string | null;
  clusterIdentity: string;
};

function createRestoreDatabaseClient(databaseUrl: string) {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5_000,
      query_timeout: 10_000,
      statement_timeout: 10_000,
      idle_in_transaction_session_timeout: 10_000,
    }),
  });
}

async function readPostgresIdentity(client: PrismaClient): Promise<PostgresIdentity> {
  const [row] = await client.$queryRaw<
    Array<{
      databaseName: string;
      databaseOid: string | null;
      serverAddress: string | null;
      serverPort: number | null;
      dataDirectory: string | null;
    }>
  >`
    SELECT current_database() AS "databaseName",
           (SELECT oid::text FROM pg_catalog.pg_database WHERE datname = current_database()) AS "databaseOid",
           inet_server_addr()::text AS "serverAddress",
           inet_server_port() AS "serverPort",
           current_setting('data_directory', true) AS "dataDirectory"
  `;
  if (!row) throw new Error("无法读取 PostgreSQL 实例身份，拒绝恢复");

  // pg_control_system exposes the cluster-wide system identifier. It is
  // restricted to pg_monitor/superusers on PostgreSQL, so retain the actual
  // server address/port and database OID as a conservative fallback for
  // restore roles that cannot read the control file.
  let systemIdentifier: string | null = null;
  try {
    const [control] = await client.$queryRaw<Array<{ systemIdentifier: string | null }>>`
      SELECT (pg_catalog.pg_control_system()).system_identifier::text AS "systemIdentifier"
    `;
    systemIdentifier = control?.systemIdentifier ?? null;
  } catch {
    // The fallback still compares the identity observed by PostgreSQL, never
    // the caller-supplied hostname or connection string.
  }
  const clusterIdentity = systemIdentifier
    ? `control:${systemIdentifier}`
    : `server:${row.serverAddress ?? "local"}:${row.serverPort ?? 0}:${row.dataDirectory ?? "unknown"}`;
  return { ...row, systemIdentifier, clusterIdentity };
}

async function assertActualRestoreDatabaseIsolation(
  sourceDb: PrismaClient,
  restoreDatabaseUrl: string,
) {
  const restoreDb = createRestoreDatabaseClient(restoreDatabaseUrl);
  try {
    const [source, restore] = await Promise.all([
      readPostgresIdentity(sourceDb),
      readPostgresIdentity(restoreDb),
    ]);
    const sameDatabase =
      source.clusterIdentity === restore.clusterIdentity &&
      (source.databaseOid && restore.databaseOid
        ? source.databaseOid === restore.databaseOid
        : source.databaseName === restore.databaseName);
    if (sameDatabase) throw new Error("RESTORE_DATABASE_URL 不得指向在线数据库");
  } finally {
    await restoreDb.$disconnect();
  }
}

export function assertRestoreIsolation(input: {
  sourceDatabaseUrl: string;
  restoreDatabaseUrl: string;
  sourceBucket: string;
  restoreBucket: string;
  backupBucket?: string;
}) {
  if (databaseIdentity(input.sourceDatabaseUrl) === databaseIdentity(input.restoreDatabaseUrl)) {
    throw new Error("RESTORE_DATABASE_URL 不得指向在线数据库");
  }
  const restoreBucket = input.restoreBucket.trim();
  if (!restoreBucket) throw new Error("离线恢复必须提供新的 RESTORE_S3_BUCKET");
  if (
    restoreBucket === input.sourceBucket.trim() ||
    (input.backupBucket && restoreBucket === input.backupBucket.trim())
  ) {
    throw new Error("RESTORE_S3_BUCKET 必须与在线证据及备份制品 bucket 隔离");
  }
}

export function assertArtifactChecksum(bytes: Uint8Array, expected: string | null) {
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) {
    throw new Error("备份运行缺少有效的制品校验和，拒绝恢复");
  }
  if (createHash("sha256").update(bytes).digest("hex") !== expected.toLowerCase()) {
    throw new Error("备份制品校验失败，拒绝恢复");
  }
}

export function selectGalleryRestoreRuns(
  selectedRunId: string,
  runs: RestoreRunArtifact[],
): Array<RestoreRunArtifact & { artifactPath: string; manifestSha256: string }> {
  const selectedIndex = runs.findIndex((item) => item.id === selectedRunId);
  if (selectedIndex < 0) throw new Error("目标图库备份不在可恢复链中");
  const selected = runs[selectedIndex]!;
  const baselineIndex =
    selected.mode === "FULL"
      ? selectedIndex
      : runs
          .slice(0, selectedIndex + 1)
          .map((item) => item.mode)
          .lastIndexOf("FULL");
  if (baselineIndex < 0) throw new Error("增量图库备份缺少完整备份基线，拒绝恢复");
  return runs.slice(baselineIndex, selectedIndex + 1).map((item) => {
    if (!item.artifactPath) throw new Error(`图库备份 ${item.id} 缺少制品路径，拒绝恢复`);
    if (!item.manifestSha256 || !/^[a-f0-9]{64}$/i.test(item.manifestSha256)) {
      throw new Error(`图库备份 ${item.id} 缺少有效校验和，拒绝恢复`);
    }
    return {
      ...item,
      artifactPath: item.artifactPath,
      manifestSha256: item.manifestSha256.toLowerCase(),
    };
  });
}

async function assertEmptyRestoreDatabase(databaseUrl: string) {
  const restoreDb = createRestoreDatabaseClient(databaseUrl);
  try {
    const objects = await restoreDb.$queryRaw<
      Array<{ objectKind: string; schemaName: string; objectName: string }>
    >`
      WITH migration_table AS (
        SELECT c.oid
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = '_prisma_migrations'
      )
      SELECT 'schema' AS "objectKind", n.nspname AS "schemaName", '' AS "objectName"
      FROM pg_catalog.pg_namespace n
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
        AND n.nspname NOT LIKE 'pg_%'
      UNION ALL
      SELECT 'relation', n.nspname, c.relname
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_index migration_index
        ON migration_index.indexrelid = c.oid
       AND migration_index.indrelid = (SELECT oid FROM migration_table)
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_toast%'
        AND NOT (
          n.nspname = 'public'
          AND (c.oid = (SELECT oid FROM migration_table) OR migration_index.indexrelid IS NOT NULL)
        )
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'e')
      UNION ALL
      SELECT 'function', n.nspname, p.proname
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_%'
      UNION ALL
      SELECT 'type', n.nspname, t.typname
      FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_%'
        AND t.typtype IN ('c', 'd', 'e', 'r', 'm')
        AND NOT (n.nspname = 'public' AND t.typname = '_prisma_migrations')
      UNION ALL
      SELECT 'extension', '', e.extname
      FROM pg_catalog.pg_extension e
      WHERE e.extname <> 'plpgsql'
      UNION ALL
      SELECT 'foreign_server', '', s.srvname
      FROM pg_catalog.pg_foreign_server s
      UNION ALL
      SELECT 'event_trigger', '', e.evtname
      FROM pg_catalog.pg_event_trigger e
    `;
    if (objects.length) {
      throw new Error(
        `恢复目标数据库非空：${objects.map((item) => `${item.schemaName}.${item.objectName}`).join(", ")}`,
      );
    }
  } finally {
    await restoreDb.$disconnect();
  }
}

async function assertEmptyRestoreBucket(config: RuntimeStorageConfig) {
  const client = await createPinnedS3Client(config);
  const result = await client.send(
    new ListObjectsV2Command({ Bucket: config.S3_BUCKET, MaxKeys: 1 }),
    { abortSignal: AbortSignal.timeout(10_000) },
  );
  if ((result.KeyCount ?? result.Contents?.length ?? 0) > 0) {
    throw new Error("恢复目标 bucket 非空，拒绝覆盖现有对象");
  }
}

async function listStorageObjectKeys(config: RuntimeStorageConfig, prefix?: string) {
  const client = await createPinnedS3Client(config);
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: config.S3_BUCKET,
        ...(prefix ? { Prefix: prefix } : {}),
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );
    keys.push(...(result.Contents ?? []).flatMap((item) => (item.Key ? [item.Key] : [])));
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

async function deleteStorageObjectKeys(config: RuntimeStorageConfig, keys: string[]) {
  const uniqueKeys = [...new Set(keys)].filter(Boolean);
  if (!uniqueKeys.length) return;
  const client = await createPinnedS3Client(config);
  for (let index = 0; index < uniqueKeys.length; index += 1000) {
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: config.S3_BUCKET,
        Delete: { Objects: uniqueKeys.slice(index, index + 1000).map((Key) => ({ Key })) },
      }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );
    if (result.Errors?.length) {
      throw new Error(
        `恢复临时对象清理失败：${result.Errors.map((item) => item.Key ?? "unknown").join(", ")}`,
      );
    }
  }
}

async function verifyStorageObjectSet(
  config: RuntimeStorageConfig,
  expected: ReadonlyMap<string, GalleryObjectEntry>,
  prefix = "",
) {
  const client = await createPinnedS3Client(config);
  const keys = await listStorageObjectKeys(config, prefix);
  const actual = [];
  for (const key of keys) {
    const head = await client.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), {
      abortSignal: AbortSignal.timeout(10_000),
    });
    const objectKey = prefix ? key.slice(prefix.length) : key;
    actual.push({ objectKey, sha256: head.Metadata?.sha256 ?? null });
  }
  assertGalleryObjectSet(expected, actual);
}

async function promoteStorageObjectSet(
  config: RuntimeStorageConfig,
  expected: ReadonlyMap<string, GalleryObjectEntry>,
  stagingPrefix: string,
) {
  const client = await createPinnedS3Client(config);
  for (const object of expected.values()) {
    const sourceKey = `${stagingPrefix}${object.objectKey}`;
    await client.send(
      new CopyObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: object.objectKey,
        CopySource: encodeURIComponent(`${config.S3_BUCKET}/${sourceKey}`),
        ContentType: object.mimeType,
        MetadataDirective: "REPLACE",
        Metadata: { sha256: object.sha256 },
      }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );
  }
}

/**
 * Archive-controlled keys must never select paths outside the extracted
 * object directory or the restore bucket. Only flat relative keys made of
 * safe path segments are accepted; traversal segments, separators outside
 * "/", control characters and absolute keys are rejected.
 */
export function assertSafeObjectKey(objectKey: string) {
  const invalid = () => new Error(`备份对象键非法，拒绝恢复：${objectKey}`);
  if (!objectKey || objectKey.includes("\\") || /[\0\r\n]/.test(objectKey)) throw invalid();
  if (objectKey.startsWith("/")) throw invalid();
  for (const segment of objectKey.split("/")) {
    if (segment === "." || segment === ".." || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)) {
      throw invalid();
    }
  }
}

export type GalleryObjectEntry = {
  objectKey: string;
  mimeType: "image/jpeg" | "image/avif";
  sha256: string;
  storageEncodingVersion?: number;
  sanitizedAt?: string | null;
};

export type GalleryTombstone = {
  objectKey: string;
  deletedAt: string;
  reason: "ORPHANED" | "DELETED" | "EXPIRED";
};

export type GalleryManifest = {
  version: 1 | 2;
  mode: "FULL" | "INCREMENTAL";
  createdAt: string;
  objects: GalleryObjectEntry[];
  tombstones: GalleryTombstone[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseGalleryObject(value: unknown, label: string): GalleryObjectEntry {
  if (!isRecord(value)) throw new Error(`${label} 不是对象，拒绝恢复`);
  const objectKey = value.objectKey;
  const mimeType = value.mimeType;
  const sha256 = value.sha256;
  const storageEncodingVersion = value.storageEncodingVersion ?? 0;
  const sanitizedAt = value.sanitizedAt ?? null;
  if (
    typeof objectKey !== "string" ||
    (mimeType !== "image/jpeg" && mimeType !== "image/avif") ||
    typeof sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(sha256) ||
    ![0, EVIDENCE_STORAGE_ENCODING_VERSION].includes(storageEncodingVersion as number) ||
    (storageEncodingVersion === EVIDENCE_STORAGE_ENCODING_VERSION &&
      (typeof sanitizedAt !== "string" || !Number.isFinite(Date.parse(sanitizedAt))))
  ) {
    throw new Error(`${label} 格式非法，拒绝恢复`);
  }
  assertSafeObjectKey(objectKey);
  return {
    objectKey,
    mimeType,
    sha256: sha256.toLowerCase(),
    ...(value.storageEncodingVersion === undefined
      ? {}
      : {
          storageEncodingVersion: storageEncodingVersion as number,
          sanitizedAt: sanitizedAt as string | null,
        }),
  };
}

function parseGalleryTombstone(value: unknown, label: string): GalleryTombstone {
  if (!isRecord(value)) throw new Error(`${label} 不是对象，拒绝恢复`);
  const objectKey = value.objectKey;
  const deletedAt = value.deletedAt;
  const reason = value.reason;
  if (
    typeof objectKey !== "string" ||
    typeof deletedAt !== "string" ||
    !Number.isFinite(Date.parse(deletedAt)) ||
    (reason !== "ORPHANED" && reason !== "DELETED" && reason !== "EXPIRED")
  ) {
    throw new Error(`${label} 格式非法，拒绝恢复`);
  }
  assertSafeObjectKey(objectKey);
  return { objectKey, deletedAt, reason };
}

export function parseGalleryManifest(value: unknown, expectedMode: "FULL" | "INCREMENTAL") {
  if (!isRecord(value)) throw new Error("图库备份 manifest 必须是对象，拒绝恢复");
  const version = value.version;
  const mode = value.mode;
  const createdAt = value.createdAt;
  if (
    (version !== 1 && version !== 2) ||
    (mode !== "FULL" && mode !== "INCREMENTAL") ||
    mode !== expectedMode ||
    typeof createdAt !== "string" ||
    !Number.isFinite(Date.parse(createdAt))
  ) {
    throw new Error("图库备份 manifest 版本、模式或时间戳非法，拒绝恢复");
  }
  if (version === 1 && mode !== "FULL") {
    throw new Error("旧版增量图库 manifest 缺少可验证删除语义，拒绝恢复");
  }
  const objectsValue =
    version === 1 && !Array.isArray(value.objects) ? value.images : value.objects;
  if (!Array.isArray(objectsValue)) throw new Error("图库 manifest 缺少 objects，拒绝恢复");
  const objects = objectsValue.map((item, index) => parseGalleryObject(item, `objects[${index}]`));
  const tombstonesValue = value.tombstones;
  if (version === 2 && !Array.isArray(tombstonesValue)) {
    throw new Error("图库 manifest 缺少 tombstones，拒绝恢复");
  }
  const tombstones = (Array.isArray(tombstonesValue) ? tombstonesValue : []).map((item, index) =>
    parseGalleryTombstone(item, `tombstones[${index}]`),
  );
  const objectKeys = new Set<string>();
  for (const object of objects) {
    if (objectKeys.has(object.objectKey)) throw new Error("图库 manifest 包含重复对象键，拒绝恢复");
    objectKeys.add(object.objectKey);
  }
  for (const tombstone of tombstones) {
    if (objectKeys.has(tombstone.objectKey)) {
      throw new Error(`图库 manifest 同时声明对象和删除，拒绝恢复：${tombstone.objectKey}`);
    }
  }
  return { version, mode, createdAt, objects, tombstones } satisfies GalleryManifest;
}

export function applyGalleryManifest(
  snapshot: ReadonlyMap<string, GalleryObjectEntry>,
  manifest: GalleryManifest,
) {
  const next = new Map(snapshot);
  for (const tombstone of manifest.tombstones) next.delete(tombstone.objectKey);
  for (const object of manifest.objects) next.set(object.objectKey, object);
  return next;
}

export function assertGalleryObjectSet(
  expected: ReadonlyMap<string, GalleryObjectEntry>,
  actual: Array<{ objectKey: string; sha256: string | null | undefined }>,
) {
  const expectedEntries = [...expected.values()]
    .map((item) => `${item.objectKey}\0${item.sha256}`)
    .sort();
  const actualEntries = actual
    .map((item) => {
      assertSafeObjectKey(item.objectKey);
      if (!item.sha256 || !/^[a-f0-9]{64}$/i.test(item.sha256)) {
        throw new Error(`恢复对象缺少校验和：${item.objectKey}`);
      }
      return `${item.objectKey}\0${item.sha256.toLowerCase()}`;
    })
    .sort();
  if (
    expectedEntries.length !== actualEntries.length ||
    expectedEntries.some((entry, index) => entry !== actualEntries[index])
  ) {
    throw new Error("恢复后的图库对象集合与 manifest 不一致，拒绝完成恢复");
  }
}

export function assertGalleryArchiveContents(manifest: GalleryManifest, listing: string) {
  const listedObjectKeys = listing
    .split("\n")
    .map((member) => member.trim())
    .filter((member) => member.startsWith("objects/") && !member.endsWith("/"))
    .map((member) => member.slice("objects/".length));
  const listed = new Set(listedObjectKeys);
  const expected = new Set(manifest.objects.map((item) => item.objectKey));
  if (listed.size !== listedObjectKeys.length || listed.size !== expected.size) {
    throw new Error("图库归档对象集合与 manifest 不一致，拒绝恢复");
  }
  for (const objectKey of expected) {
    if (!listed.has(objectKey)) throw new Error(`图库归档对象集合缺少对象：${objectKey}`);
  }
}

export function normalizeRemoteBackupBasePath(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed;
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.endsWith("/") ||
    normalized.includes("\\") ||
    normalized.includes(":") ||
    /[\u0000-\u001f\u007f]/.test(trimmed) ||
    trimmed !== value ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("远程备份 basePath 必须是安全的相对路径");
  }
  return normalized;
}

/** rclone config values are interpolated into a config file; reject controls. */
function assertRcloneSafeValue(value: string, label: string) {
  if (/[\u0000-\u001f\u007f]/.test(value) || value.trim() !== value) {
    throw new Error(`备份目标${label}包含控制字符或非法空白字符`);
  }
}

function normalizeProxyHost(value: string) {
  return value.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

/**
 * Rclone does not expose a DNS lookup hook. Route HTTP(S)/FTP through a
 * short-lived loopback proxy that only connects to the address validated for
 * this operation. This preserves the original hostname for Host/SNI while
 * removing the second DNS lookup that would otherwise permit rebinding.
 */
function parsePassivePortRange(value: string | undefined) {
  if (!value) return undefined;
  const [minimum, maximum] = value.split("-").map(Number);
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum)) {
    throw new Error("被动 FTP 端口范围无效");
  }
  return { minimum, maximum };
}

async function startPinnedProxy(
  resolved: ResolvedExternalEndpoint,
  allowAnyPort: boolean,
  passivePortRange?: { minimum: number; maximum: number },
) {
  const expectedHost = normalizeProxyHost(resolved.url.hostname);
  const expectedPort = Number(
    resolved.url.port || (resolved.url.protocol === "https:" ? "443" : "80"),
  );
  const token = randomBytes(24).toString("base64url");
  const expectedAuthorization = `Basic ${Buffer.from(`${token}:${token}`).toString("base64")}`;
  const sockets = new Set<import("node:net").Socket>();

  const permitted = (host: string, port: number) => {
    const normalized = normalizeProxyHost(host);
    return (
      (normalized === expectedHost ||
        (allowAnyPort && normalized === normalizeProxyHost(resolved.address.address))) &&
      Number.isInteger(port) &&
      port >= 1 &&
      port <= 65_535 &&
      (allowAnyPort
        ? port === expectedPort ||
          !passivePortRange ||
          (port >= passivePortRange.minimum && port <= passivePortRange.maximum)
        : port === expectedPort)
    );
  };
  const authorized = (header: string | undefined) => header === expectedAuthorization;

  const server = createServer((request, response) => {
    if (!authorized(request.headers["proxy-authorization"])) {
      response.writeHead(407, { "proxy-authenticate": 'Basic realm="crewqual"' });
      response.end();
      return;
    }
    let target: URL;
    try {
      target = new URL(request.url ?? "");
    } catch {
      response.writeHead(400).end();
      return;
    }
    const port = Number(target.port || (target.protocol === "https:" ? "443" : "80"));
    if (
      (target.protocol !== "http:" && target.protocol !== "https:") ||
      !permitted(target.hostname, port)
    ) {
      response.writeHead(403).end();
      return;
    }
    const headers: Record<string, string | string[] | undefined> = {
      ...request.headers,
      host: target.host,
    };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const send = target.protocol === "https:" ? proxyHttpsRequest : proxyHttpRequest;
    const upstream = send(
      {
        hostname: resolved.address.address,
        family: resolved.address.family,
        port,
        method: request.method,
        path: `${target.pathname}${target.search}`,
        headers,
        ...(target.protocol === "https:" && isIP(expectedHost) === 0
          ? { servername: expectedHost }
          : {}),
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  });

  server.on("connect", (request, client, head) => {
    if (!authorized(request.headers["proxy-authorization"])) {
      client.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="crewqual"\r\n\r\n',
      );
      return;
    }
    let target: URL;
    try {
      target = new URL(`http://${request.url}`);
    } catch {
      client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    const port = Number(target.port || "80");
    if (!permitted(target.hostname, port)) {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = connectSocket({
      host: resolved.address.address,
      family: resolved.address.family,
      port,
    });
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法启动固定地址代理");
  return {
    url: `http://${token}:${token}@127.0.0.1:${address.port}`,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function obscureRcloneValue(value: string) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn("rclone", ["obscure", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: minimalSubprocessEnvironment(),
    });
    const output: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > 4096 && !settled) {
        settled = true;
        child.kill();
        reject(new Error("rclone 密钥处理失败"));
        return;
      }
      output.push(chunk);
    });
    child.stderr.resume();
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(new Error(`无法执行 rclone 密钥处理：${error.message}`));
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      const obscured = Buffer.concat(output).toString("utf8").trim();
      if (code !== 0 || !obscured || /[\u0000-\u001f\u007f]/.test(obscured)) {
        reject(new Error("rclone 密钥处理失败"));
        return;
      }
      resolve(obscured);
    });
    child.stdin.end(`${value}\n`);
  });
}

/**
 * Validate a tar listing before extracting an attacker-influenceable gallery
 * archive. Names must be manifest.json or objects/<relative object key>
 * (directory entries allowed); member types must be regular files or
 * directories — symlink/hardlink members would route the later readFile of a
 * manifest-controlled key to an arbitrary file inside the restore container.
 */
export function assertSafeArchiveMembers(listing: string, verboseListing: string) {
  const members = listing
    .split("\n")
    .map((member) => member.trim())
    .filter(Boolean);
  if (!members.includes("manifest.json")) {
    throw new Error("备份归档缺少 manifest.json，拒绝恢复");
  }
  const types = verboseListing
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (types.length !== members.length) {
    // Desynchronized listings mean an unparseable (hostile) archive.
    throw new Error("备份归档清单无法解析，拒绝恢复");
  }
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index]!;
    const type = types[index]!.charAt(0);
    if (type !== "-" && type !== "d") {
      throw new Error(`备份归档包含非常规成员，拒绝恢复：${member}`);
    }
    if (member === "manifest.json" || member === "objects" || member === "objects/") continue;
    if (member.startsWith("objects/")) {
      const relative = member.replace(/\/$/, "").slice("objects/".length);
      if (relative) assertSafeObjectKey(relative);
      continue;
    }
    throw new Error(`备份归档包含意外成员，拒绝恢复：${member}`);
  }
}

function encryptArtifact(bytes: Uint8Array, secret: string) {
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([Buffer.from("CQBK1\0"), iv, cipher.getAuthTag(), encrypted]);
}

function decryptArtifact(bytes: Uint8Array, secret: string) {
  const buffer = Buffer.from(bytes);
  if (buffer.subarray(0, 6).toString() !== "CQBK1\0") return buffer;
  const key = createHash("sha256").update(secret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(6, 18));
  decipher.setAuthTag(buffer.subarray(18, 34));
  return Buffer.concat([decipher.update(buffer.subarray(34)), decipher.final()]);
}

type BackupTargetRecord = {
  type: BackupTargetType;
  endpoint: string;
  basePath: string;
  secretCiphertext: string | null;
};

function assertBackupArtifactName(name: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error("备份制品文件名非法");
  }
}

export function backupArtifactName(
  source: "GALLERY" | "DATABASE",
  runId: string,
  startedAt: Date,
  encrypted: boolean,
) {
  return `${source.toLowerCase()}-${runId}-${startedAt.getTime()}.${encrypted ? "enc" : "dump"}`;
}

async function localArtifactPath(
  target: BackupTargetRecord,
  name: string,
  requireRegularFile = false,
) {
  assertBackupArtifactName(name);
  const directory = await prepareLocalBackupDirectory(target.endpoint, target.basePath);
  const candidate = join(directory, name);
  if (requireRegularFile) {
    const [metadata, resolved] = await Promise.all([lstat(candidate), realpath(candidate)]);
    if (metadata.isSymbolicLink() || !metadata.isFile() || resolved !== candidate) {
      throw new Error("本地备份制品不是受信任的常规文件");
    }
  }
  return candidate;
}

function requireRcloneCredentials(
  target: BackupTargetRecord,
  credentials: ParsedBackupCredentials,
): ParsedRemoteBackupCredentials {
  if (target.type === "LOCAL" || credentials.type === "LOCAL" || credentials.type !== target.type) {
    throw new Error("备份目标凭据类型与目标协议不匹配");
  }
  return credentials;
}

async function runRclone(
  target: BackupTargetRecord,
  args: string[],
  credentials: ParsedRemoteBackupCredentials,
) {
  if (credentials.type !== target.type) throw new Error("备份目标凭据类型与目标协议不匹配");
  assertRcloneSafeValue(target.endpoint, "服务地址");
  normalizeRemoteBackupBasePath(target.basePath);
  const resolved = await assertBackupEndpointResolved(
    credentials.type,
    target.endpoint,
    getServerConfig(),
  );
  const configDir = await mkdtemp(join(tmpdir(), "crewqual-rclone-"));
  const configPath = join(configDir, "rclone.conf");
  const obscured = async (value: string) => (value ? await obscureRcloneValue(value) : "");
  const passivePortRange =
    credentials.type === "FTP"
      ? parsePassivePortRange(credentials.values.passivePortRange)
      : undefined;
  let proxy: Awaited<ReturnType<typeof startPinnedProxy>> | undefined;
  try {
    proxy =
      credentials.type === "SMB"
        ? undefined
        : await startPinnedProxy(resolved, credentials.type === "FTP", passivePortRange);
    const lines = ["[crewqual]"];
    if (credentials.type === "S3") {
      const values = credentials.values;
      assertRcloneSafeValue(values.accessKeyId ?? values.username ?? "", "访问密钥 ID");
      lines.push(
        "type = s3",
        "provider = Other",
        "force_path_style = true",
        "endpoint = " + target.endpoint,
        "access_key_id = " + (values.accessKeyId ?? values.username ?? ""),
        "secret_access_key = " + (await obscured(values.secretAccessKey ?? values.password ?? "")),
      );
    } else if (credentials.type === "SMB") {
      const values = credentials.values;
      assertRcloneSafeValue(values.username ?? "", "用户名");
      lines.push(
        "type = smb",
        "host = " + resolved.address.address,
        "port = " + (resolved.url.port || "445"),
        "user = " + (values.username ?? ""),
        "pass = " + (await obscured(values.password ?? "")),
      );
    } else if (credentials.type === "FTP") {
      const values = credentials.values;
      assertRcloneSafeValue(values.username ?? "", "用户名");
      lines.push(
        "type = ftp",
        "host = " + normalizeProxyHost(resolved.url.hostname),
        "port = " + (resolved.url.port || "21"),
        "user = " + (values.username ?? ""),
        "pass = " + (await obscured(values.password ?? "")),
        "tls = " + (values.tls === "false" ? "false" : "true"),
        "http_proxy = " + proxy!.url,
      );
    } else {
      const values = credentials.values;
      assertRcloneSafeValue(values.username ?? "", "用户名");
      lines.push(
        "type = webdav",
        "url = " + target.endpoint,
        "vendor = other",
        "user = " + (values.username ?? ""),
        "pass = " + (await obscured(values.password ?? "")),
      );
    }
    await writeFile(configPath, `${lines.join("\n")}\n`, { mode: 0o600 });
    const proxyArgs = proxy && credentials.type !== "FTP" ? ["--http-proxy", proxy.url] : [];
    const childEnvironment = minimalSubprocessEnvironment();
    return await execFileAsync("rclone", ["--config", configPath, ...proxyArgs, ...args], {
      timeout: 60 * 60 * 1000,
      env: proxy
        ? {
            ...childEnvironment,
            HTTP_PROXY: proxy.url,
            HTTPS_PROXY: proxy.url,
            http_proxy: proxy.url,
            https_proxy: proxy.url,
            NO_PROXY: "",
            no_proxy: "",
          }
        : childEnvironment,
    });
  } finally {
    await proxy?.close();
    await rm(configDir, { recursive: true, force: true });
  }
}

function rcloneDestination(target: BackupTargetRecord, name: string) {
  if (name) assertBackupArtifactName(name);
  const basePath = normalizeRemoteBackupBasePath(target.basePath);
  return `crewqual:${basePath}${name ? `/${name}` : "/"}`;
}

async function copyArtifact(
  source: string,
  target: BackupTargetRecord,
  destinationName: string,
  credentials: ParsedBackupCredentials,
) {
  if (target.type === "LOCAL") {
    const destination = await localArtifactPath(target, destinationName);
    await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
    return destination;
  }
  const destination = rcloneDestination(target, destinationName);
  await runRclone(
    target,
    ["copyto", source, destination],
    requireRcloneCredentials(target, credentials),
  );
  return destination;
}

async function fetchArtifact(
  path: string,
  target: BackupTargetRecord,
  destination: string,
  credentials: ParsedBackupCredentials,
) {
  if (target.type === "LOCAL") {
    const source = await localArtifactPath(target, basename(path), true);
    await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
    return;
  }
  await runRclone(
    target,
    ["copyto", rcloneDestination(target, path.split("/").pop() ?? ""), destination],
    requireRcloneCredentials(target, credentials),
  );
}

async function deleteArtifact(
  path: string,
  target: BackupTargetRecord,
  credentials: ParsedBackupCredentials,
) {
  const name = basename(path);
  assertBackupArtifactName(name);
  if (target.type === "LOCAL") {
    const localPath = await localArtifactPath(target, name);
    await rm(localPath, { force: true });
    return;
  }
  await runRclone(
    target,
    ["deletefile", rcloneDestination(target, name)],
    requireRcloneCredentials(target, credentials),
  );
}

async function hasBackupRunLease(runId: string, startedAt: Date) {
  const current = await getPrisma().backupRun.findUnique({
    where: { id: runId },
    select: { status: true, startedAt: true },
  });
  return current?.status === "RUNNING" && current.startedAt?.getTime() === startedAt.getTime();
}

export function postgresClientEnvironment(
  databaseUrl: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  return postgresEnvironmentFromUrl(databaseUrl, minimalSubprocessEnvironment(environment));
}

export async function restorePostgresArchive(databaseUrl: string, archivePath: string) {
  const env = postgresClientEnvironment(databaseUrl);
  // pg_restore requires --dbname to enter database mode; PGDATABASE alone
  // does not select it. Quote a dbname-only conninfo value so unusual database
  // names cannot be interpreted as connection options. Credentials stay in env.
  const database = env.PGDATABASE!.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  await execFileAsync(
    "pg_restore",
    [
      "--dbname",
      `dbname='${database}'`,
      "--clean",
      "--if-exists",
      "--exit-on-error",
      "--single-transaction",
      archivePath,
    ],
    { timeout: 60 * 60 * 1000, env },
  );
}

export async function executeBackupRun(runId: string) {
  const db = getPrisma();
  const run = await db.backupRun.findUnique({
    where: { id: runId },
    include: { plan: { include: { target: true } } },
  });
  if (!run || run.status !== "QUEUED") return { status: "ignored" as const };
  // Use the claim time as the inclusive snapshot watermark. Advancing the
  // plan to completion time would lose objects created after the manifest
  // query but before the artifact upload completed.
  const snapshotAt = new Date();
  const claimed = await db.backupRun.updateMany({
    where: { id: run.id, status: "QUEUED" },
    data: { status: "RUNNING", startedAt: snapshotAt },
  });
  if (claimed.count !== 1) return { status: "ignored" as const };
  const workdir = await mkdtemp(join(tmpdir(), "crewqual-backup-"));
  let destination: string | null = null;
  let credentials: ParsedBackupCredentials | null = null;
  let committed = false;
  try {
    const targetSecret = run.plan.target.secretCiphertext
      ? decryptSettingSecret(run.plan.target.secretCiphertext)
      : "";
    credentials = parseBackupCredentials(run.plan.target.type, targetSecret);
    const encryptionSecret = backupArtifactEncryptionSecret(credentials, targetSecret);
    if (run.plan.target.encryptionEnabled && !encryptionSecret)
      throw new Error("备份目标未配置加密密钥");
    if (run.plan.source === "GALLERY" && run.mode === "INCREMENTAL" && !run.plan.lastSuccessfulAt) {
      throw new Error("图库首次备份必须先成功执行 FULL，拒绝生成无基线增量备份");
    }
    // The claim timestamp is the storage fencing token. A reclaimed run gets
    // a different object name, so a stale worker can neither overwrite nor
    // commit the current worker's artifact.
    const artifactName = backupArtifactName(
      run.plan.source,
      run.id,
      snapshotAt,
      run.plan.target.encryptionEnabled,
    );
    const artifactPath = join(workdir, artifactName);
    if (run.plan.source === "DATABASE") {
      const rawPath = join(workdir, "database.dump");
      const config = getServerConfig();
      const [{ serverVersion }] = await db.$queryRaw<Array<{ serverVersion: string }>>`
        SELECT current_setting('server_version_num') AS "serverVersion"
      `;
      const pgDumpVersion = String(
        (
          await execFileAsync("pg_dump", ["--version"], {
            env: minimalSubprocessEnvironment(),
          })
        ).stdout,
      );
      const dumpMajor = pgDumpVersion.match(/\b(\d+)\./)?.[1];
      const serverMajor = String(Math.floor(Number(serverVersion) / 10000));
      if (!dumpMajor || dumpMajor !== serverMajor) {
        throw new Error(
          `pg_dump 主版本 ${dumpMajor ?? "unknown"} 与 PostgreSQL ${serverMajor} 不兼容`,
        );
      }
      await execFileAsync("pg_dump", ["--format=custom", "--file", rawPath], {
        timeout: 60 * 60 * 1000,
        // Keep credentials out of process argv, which may be visible to
        // other local processes through procfs or process listings.
        env: postgresClientEnvironment(config.DATABASE_URL),
      });
      const raw = await readFile(rawPath);
      await writeFile(
        artifactPath,
        run.plan.target.encryptionEnabled ? encryptArtifact(raw, encryptionSecret) : raw,
      );
    } else {
      const images = await db.evidenceImage.findMany({
        where: { status: { not: "orphaned" }, updatedAt: { lte: snapshotAt } },
        select: {
          objectKey: true,
          sha256: true,
          mimeType: true,
          updatedAt: true,
          storageEncodingVersion: true,
          sanitizedAt: true,
        },
      });
      const manifest = images.map((image) => ({
        objectKey: image.objectKey,
        sha256: image.sha256,
        mimeType: image.mimeType,
        storageEncodingVersion: image.storageEncodingVersion,
        sanitizedAt: image.sanitizedAt?.toISOString() ?? null,
      }));
      const changed =
        run.mode === "INCREMENTAL" && run.plan.lastSuccessfulAt
          ? images
              .filter((image) => image.updatedAt > run.plan.lastSuccessfulAt!)
              .map((image) => ({
                objectKey: image.objectKey,
                sha256: image.sha256,
                mimeType: image.mimeType,
                storageEncodingVersion: image.storageEncodingVersion,
                sanitizedAt: image.sanitizedAt?.toISOString() ?? null,
              }))
          : manifest;
      const tombstoneRows =
        run.mode === "INCREMENTAL" && run.plan.lastSuccessfulAt
          ? await db.$queryRaw<Array<{ objectKey: string; deletedAt: Date; reason: string }>>`
              SELECT "objectKey", "deletedAt", "reason"
              FROM "GalleryObjectTombstone"
              WHERE "deletedAt" > ${run.plan.lastSuccessfulAt}
                AND "deletedAt" <= ${snapshotAt}
              ORDER BY "deletedAt" ASC, "objectKey" ASC
            `
          : await db.$queryRaw<Array<{ objectKey: string; deletedAt: Date; reason: string }>>`
              SELECT "objectKey", "deletedAt", "reason"
              FROM "GalleryObjectTombstone"
              WHERE "deletedAt" <= ${snapshotAt}
              ORDER BY "deletedAt" ASC, "objectKey" ASC
            `;
      for (const image of changed) assertSafeObjectKey(image.objectKey);
      const tombstones = tombstoneRows.map((tombstone) => {
        assertSafeObjectKey(tombstone.objectKey);
        if (
          tombstone.reason !== "ORPHANED" &&
          tombstone.reason !== "DELETED" &&
          tombstone.reason !== "EXPIRED"
        ) {
          throw new Error(`图库删除记录原因非法：${tombstone.objectKey}`);
        }
        return {
          objectKey: tombstone.objectKey,
          deletedAt: tombstone.deletedAt.toISOString(),
          reason: tombstone.reason,
        };
      });
      const changedKeys = new Set(changed.map((image) => image.objectKey));
      if (tombstones.some((tombstone) => changedKeys.has(tombstone.objectKey))) {
        throw new Error("图库备份同时包含对象和删除记录，拒绝生成 manifest");
      }
      const raw = Buffer.from(
        JSON.stringify({
          version: 2,
          mode: run.mode,
          createdAt: snapshotAt.toISOString(),
          objects: changed,
          tombstones,
        }),
      );
      await writeFile(
        artifactPath,
        run.plan.target.encryptionEnabled ? encryptArtifact(raw, encryptionSecret) : raw,
      );
      await writeFile(join(workdir, "manifest.json"), raw);
      await mkdir(join(workdir, "objects"), { recursive: true });
      for (const image of changed) {
        const objectPath = join(workdir, "objects", image.objectKey);
        await mkdir(dirname(objectPath), { recursive: true });
        const bytes = await readPrivateEvidence(image.objectKey);
        const actualSha256 = createHash("sha256").update(bytes).digest("hex");
        if (actualSha256 !== image.sha256) {
          throw new Error(`证据对象校验失败：${image.objectKey}`);
        }
        await writeFile(objectPath, bytes);
      }
      const rawArchive = join(workdir, "gallery.tar");
      await execFileAsync("tar", ["-cf", rawArchive, "manifest.json", "objects"], {
        cwd: workdir,
        timeout: 60 * 60 * 1000,
        env: minimalSubprocessEnvironment(),
      });
      const archive = await readFile(rawArchive);
      await writeFile(
        artifactPath,
        run.plan.target.encryptionEnabled ? encryptArtifact(archive, encryptionSecret) : archive,
      );
    }
    const artifactBytes = await readFile(artifactPath);
    const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");
    if (!(await hasBackupRunLease(run.id, snapshotAt))) {
      return { status: "ignored" as const };
    }
    destination = await copyArtifact(artifactPath, run.plan.target, artifactName, credentials);
    const verificationPath = join(workdir, "uploaded-verification.bin");
    await fetchArtifact(destination, run.plan.target, verificationPath, credentials);
    assertArtifactChecksum(await readFile(verificationPath), artifactSha256);
    if (!(await hasBackupRunLease(run.id, snapshotAt))) {
      await deleteArtifact(destination, run.plan.target, credentials).catch(() => undefined);
      destination = null;
      return { status: "ignored" as const };
    }
    const bytes = artifactBytes.byteLength;
    const completed = await db.backupRun.updateMany({
      where: { id: run.id, status: "RUNNING", startedAt: snapshotAt },
      data: {
        status: "SUCCEEDED",
        completedAt: new Date(),
        artifactPath: destination,
        bytesWritten: bytes,
        manifestSha256: artifactSha256,
      },
    });
    if (completed.count !== 1) {
      await deleteArtifact(destination, run.plan.target, credentials).catch(() => undefined);
      destination = null;
      return { status: "ignored" as const };
    }
    committed = true;
    await db.backupPlan.updateMany({
      where: {
        id: run.planId,
        OR: [{ lastSuccessfulAt: null }, { lastSuccessfulAt: { lt: snapshotAt } }],
      },
      data: { lastSuccessfulAt: snapshotAt },
    });
    return { status: "succeeded" as const, bytes };
  } catch (error) {
    if (destination && credentials && !committed) {
      await deleteArtifact(destination, run.plan.target, credentials).catch(() => undefined);
      destination = null;
    }
    const failed = await db.backupRun.updateMany({
      where: { id: run.id, status: "RUNNING", startedAt: snapshotAt },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    if (failed.count !== 1) return { status: "ignored" as const };
    return {
      status: "failed" as const,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function processQueuedBackupRuns() {
  await recoverStaleBackupRuns();
  const db = getPrisma();
  const plans = await db.backupPlan.findMany({
    where: { enabled: true },
    include: { runs: { where: { status: { in: ["QUEUED", "RUNNING"] } }, take: 1 } },
  });
  const now = new Date();
  const partsFor = (timezone: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      minute: "numeric",
      hour: "numeric",
      day: "numeric",
      month: "numeric",
      weekday: "short",
      hourCycle: "h23",
    }).formatToParts(now);
    const values = Object.fromEntries(
      parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
    );
    return {
      minute: Number(values.minute),
      hour: Number(values.hour),
      day: Number(values.day),
      month: Number(values.month),
      weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.weekday),
    };
  };
  const matches = (value: number, expression: string) =>
    expression === "*" ||
    expression
      .split(",")
      .some((part) =>
        part.startsWith("*/") ? value % Number(part.slice(2)) === 0 : Number(part) === value,
      );
  for (const plan of plans) {
    const fields = plan.cron.trim().split(/\s+/);
    if (fields.length !== 5 || plan.runs.length) continue;
    const { minute, hour, day, month, weekday } = partsFor(plan.timezone);
    if (
      !matches(minute, fields[0]!) ||
      !matches(hour, fields[1]!) ||
      !matches(day, fields[2]!) ||
      !matches(month, fields[3]!) ||
      !matches(weekday, fields[4]!)
    )
      continue;
    if (plan.lastSuccessfulAt && now.getTime() - plan.lastSuccessfulAt.getTime() < 45_000) continue;
    const scheduledFor = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    await db.backupRun
      .create({ data: { planId: plan.id, mode: plan.mode, scheduledFor } })
      .catch((error: unknown) => {
        // Two workers can observe the same minute. The composite unique key
        // makes the second claim a harmless no-op.
        if ((error as { code?: string }).code !== "P2002") throw error;
      });
  }
  const runs = await db.backupRun.findMany({
    where: { status: "QUEUED" },
    select: { id: true },
    take: 1,
    orderBy: { createdAt: "asc" },
  });
  if (!runs[0]) return { processed: 0 };
  await executeBackupRun(runs[0].id);
  return { processed: 1 };
}

/** Requeue only runs whose worker lease is definitely stale. */
export async function recoverStaleBackupRuns(now = new Date()) {
  const staleBefore = new Date(now.getTime() - BACKUP_RUN_STALE_AFTER_MS);
  return getPrisma().backupRun.updateMany({
    where: {
      status: "RUNNING",
      OR: [{ startedAt: null }, { startedAt: { lt: staleBefore } }],
    },
    data: {
      status: "QUEUED",
      startedAt: null,
      completedAt: null,
      errorMessage: null,
    },
  });
}

export async function restoreBackupRun(runId: string, confirmation: string) {
  if (process.env.CREWQUAL_OFFLINE_RESTORE !== "1") {
    throw new Error("在线服务禁止执行恢复；请使用隔离 restore profile 和 recoverySetId");
  }
  const restoreDatabaseUrl = process.env.RESTORE_DATABASE_URL;
  if (!restoreDatabaseUrl) {
    throw new Error("离线恢复必须提供指向全新隔离数据库的 RESTORE_DATABASE_URL");
  }
  const restoreBucket = process.env.RESTORE_S3_BUCKET?.trim();
  if (!restoreBucket) throw new Error("离线恢复必须提供新的 RESTORE_S3_BUCKET");
  if (confirmation !== "恢复") throw new Error("必须输入“恢复”确认破坏性操作");
  const serverConfig = getServerConfig();
  const db = getPrisma();
  const run = await db.backupRun.findUnique({
    where: { id: runId },
    include: { plan: { include: { target: true } } },
  });
  if (!run || run.status !== "SUCCEEDED" || !run.artifactPath)
    throw new Error("备份运行记录不存在或未成功");
  const sourceStorage = await getRuntimeStorageConfig();
  const backupBucket =
    run.plan.target.type === "S3"
      ? run.plan.target.basePath.replace(/^\/+|\/+$/g, "").split("/")[0]
      : undefined;
  assertRestoreIsolation({
    sourceDatabaseUrl: serverConfig.DATABASE_URL,
    restoreDatabaseUrl,
    sourceBucket: sourceStorage.S3_BUCKET,
    restoreBucket,
    backupBucket,
  });
  await assertActualRestoreDatabaseIsolation(db, restoreDatabaseUrl);
  const restoreStorage: RuntimeStorageConfig = {
    ...sourceStorage,
    S3_BUCKET: restoreBucket,
  };
  const workdir = await mkdtemp(join(tmpdir(), "crewqual-restore-"));
  try {
    const secret = run.plan.target.secretCiphertext
      ? decryptSettingSecret(run.plan.target.secretCiphertext)
      : "";
    const credentials = parseBackupCredentials(run.plan.target.type, secret);
    const encryptionSecret = backupArtifactEncryptionSecret(credentials, secret);
    if (run.plan.source === "DATABASE") {
      if (!run.manifestSha256 || !/^[a-f0-9]{64}$/i.test(run.manifestSha256)) {
        throw new Error("备份运行缺少有效的制品校验和，拒绝恢复");
      }
      await assertEmptyRestoreDatabase(restoreDatabaseUrl);
      const downloaded = join(workdir, "artifact.bin");
      await fetchArtifact(run.artifactPath, run.plan.target, downloaded, credentials);
      const downloadedBytes = await readFile(downloaded);
      assertArtifactChecksum(downloadedBytes, run.manifestSha256);
      const restored = decryptArtifact(downloadedBytes, encryptionSecret);
      const restoreFile = join(workdir, "restore.dump");
      await writeFile(restoreFile, restored);
      // A fresh target plus a single transaction makes a failed restore
      // rollback instead of leaving a partially reconstructed database.
      await restorePostgresArchive(restoreDatabaseUrl, restoreFile);
      const restoredDb = createRestoreDatabaseClient(restoreDatabaseUrl);
      try {
        await resetRestoredEvidenceTrust(restoredDb);
      } finally {
        await restoredDb.$disconnect();
      }
      return {
        source: "DATABASE",
        status: "restored" as const,
        evidenceStatus: "awaiting_gallery_rebuild",
      };
    }
    const runs =
      run.mode === "INCREMENTAL"
        ? await db.backupRun.findMany({
            where: { planId: run.planId, status: "SUCCEEDED", createdAt: { lte: run.createdAt } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          })
        : [run];
    const restoreRuns = selectGalleryRestoreRuns(run.id, runs);
    const stagingPrefix = `.crewqual-restore/${run.id}/`;
    await deleteStorageObjectKeys(
      restoreStorage,
      await listStorageObjectKeys(restoreStorage, stagingPrefix),
    );
    await assertEmptyRestoreBucket(restoreStorage);
    const expected = new Map<string, GalleryObjectEntry>();
    const rebuiltObjects = new Map<string, RebuiltRestoreObject>();
    try {
      for (let index = 0; index < restoreRuns.length; index += 1) {
        const galleryRun = restoreRuns[index]!;
        const downloaded = join(workdir, `gallery-${index}.bin`);
        await fetchArtifact(galleryRun.artifactPath, run.plan.target, downloaded, credentials);
        const downloadedBytes = await readFile(downloaded);
        assertArtifactChecksum(downloadedBytes, galleryRun.manifestSha256);
        const archive = join(workdir, `gallery-${index}.tar`);
        await writeFile(archive, decryptArtifact(downloadedBytes, encryptionSecret));
        const extractDir = join(workdir, `extract-${index}`);
        await mkdir(extractDir, { recursive: true });
        // Member allowlist plus member type check: the archive is
        // attacker-influenceable when the backup store is compromised, so
        // refuse any entry outside manifest.json / objects/<safe-key> and any
        // non-regular-file member before extraction.
        const tarListOptions = {
          timeout: 60 * 60 * 1000,
          maxBuffer: MAX_TAR_LISTING_BYTES,
          env: minimalSubprocessEnvironment(),
        };
        const listing = (await execFileAsync("tar", ["-tf", archive], tarListOptions)).stdout;
        const verboseListing = (await execFileAsync("tar", ["-tvf", archive], tarListOptions))
          .stdout;
        assertSafeArchiveMembers(listing, verboseListing);
        await execFileAsync("tar", ["-xf", archive, "-C", extractDir], {
          timeout: 60 * 60 * 1000,
          env: minimalSubprocessEnvironment(),
        });
        const manifest = parseGalleryManifest(
          JSON.parse(await readFile(join(extractDir, "manifest.json"), "utf8")),
          galleryRun.mode,
        );
        assertGalleryArchiveContents(manifest, listing);
        const next = applyGalleryManifest(expected, manifest);
        expected.clear();
        for (const [objectKey, object] of next) expected.set(objectKey, object);
        for (const tombstone of manifest.tombstones) rebuiltObjects.delete(tombstone.objectKey);
        await deleteStorageObjectKeys(
          restoreStorage,
          manifest.tombstones.map((tombstone) => `${stagingPrefix}${tombstone.objectKey}`),
        );
        for (const image of manifest.objects) {
          const bytes = await readFile(join(extractDir, "objects", image.objectKey));
          if (createHash("sha256").update(bytes).digest("hex") !== image.sha256) {
            throw new Error(`备份证据校验失败，拒绝恢复：${image.objectKey}`);
          }
          const rebuilt = await prepareRestoredEvidence(image, bytes);
          rebuiltObjects.set(image.objectKey, rebuilt.object);
          await putPrivateObjectAtKey(
            `${stagingPrefix}${image.objectKey}`,
            rebuilt.bytes,
            rebuilt.object.mimeType,
            rebuilt.object.sha256,
            restoreStorage,
          );
        }
      }
      await verifyStorageObjectSet(restoreStorage, rebuiltObjects, stagingPrefix);
      await promoteStorageObjectSet(restoreStorage, rebuiltObjects, stagingPrefix);
      await deleteStorageObjectKeys(
        restoreStorage,
        await listStorageObjectKeys(restoreStorage, stagingPrefix),
      );
      await verifyStorageObjectSet(restoreStorage, rebuiltObjects);
      const restoredDb = createRestoreDatabaseClient(restoreDatabaseUrl);
      try {
        await finalizeRestoredEvidence(restoredDb, expected, rebuiltObjects);
      } finally {
        await restoredDb.$disconnect();
      }
      return {
        source: "GALLERY",
        restoredObjects: expected.size,
        status: "restored" as const,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await deleteStorageObjectKeys(restoreStorage, [
          ...(await listStorageObjectKeys(restoreStorage, stagingPrefix)),
          ...expected.keys(),
        ]);
      } catch (cleanupError) {
        const cleanupMessage =
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        throw new Error(`${message}；恢复临时对象清理失败：${cleanupMessage}`);
      }
      throw error;
    }
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function testBackupTarget(targetId: string) {
  const db = getPrisma();
  const target = await db.backupTarget.findUnique({ where: { id: targetId } });
  if (!target) throw new Error("备份目标不存在");
  const secret = target.secretCiphertext ? decryptSettingSecret(target.secretCiphertext) : "";
  const credentials = parseBackupCredentials(target.type, secret);
  const testedAt = new Date();
  try {
    if (target.type === "LOCAL") {
      await prepareLocalBackupDirectory(target.endpoint, target.basePath);
    } else
      await runRclone(
        target,
        ["lsd", rcloneDestination(target, "")],
        requireRcloneCredentials(target, credentials),
      );
    await db.backupTarget.update({
      where: { id: target.id },
      data: { lastTestedAt: testedAt, lastTestMessage: "连接成功" },
    });
    return { ok: true, testedAt: testedAt.toISOString(), message: "连接成功" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.backupTarget.update({
      where: { id: target.id },
      data: { lastTestedAt: testedAt, lastTestMessage: message },
    });
    return { ok: false, testedAt: testedAt.toISOString(), message };
  }
}
