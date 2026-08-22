import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  DeleteObjectCommand,
  GetBucketEncryptionCommand,
  GetBucketPolicyCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  GetPublicAccessBlockCommand,
  GetBucketVersioningCommand,
  HeadObjectCommand,
  PutObjectAclCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PILOT_TEMPLATE_PACK } from "../../src/server/template-packs";
import {
  artifactDir,
  command,
  ensureDir,
  gate,
  parseArgs,
  required,
  runId,
  sha256File,
  writeJson,
  type ReleaseEvidence,
} from "./verify-common";

function envOr(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

let pnpmRunner: "pnpm" | "corepack" | undefined;

function pnpmCommand(args: string[], options: { allowFailure?: boolean } = {}) {
  if (!pnpmRunner) {
    pnpmRunner =
      command("pnpm", ["--version"], { allowFailure: true }).status === 0 ? "pnpm" : "corepack";
  }
  return pnpmRunner === "pnpm"
    ? command("pnpm", args, options)
    : command("corepack", ["pnpm", ...args], options);
}

const RELEASE_IMAGE_NAMES = ["RELEASE_WEB_IMAGE", "RELEASE_RUNTIME_IMAGE"] as const;

const IMAGE_SIZE_LIMITS = {
  RELEASE_WEB_IMAGE: 110 * 1024 * 1024,
  // 232,079,746 compressed layer bytes from the clean linux/amd64 local build;
  // the 244 MiB limit is the rounded-up 110% allowance.
  RELEASE_RUNTIME_IMAGE: 244 * 1024 * 1024,
} as const;
const IMAGE_TOTAL_LIMIT = 641 * 1024 * 1024;

function composeArgs(project: string, envFile: string, args: string[]) {
  return [
    "compose",
    "-f",
    "docker-compose.release.yml",
    "--env-file",
    envFile,
    "-p",
    project,
    ...args,
  ];
}

async function waitFor(url: string, expected = 200, timeoutMs = 180_000) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.status === expected) return;
      last = `${response.status} ${await response.text()}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for ${url}; last result: ${last}`);
}

async function writeGateEvidence(dir: string, name: string, value: unknown) {
  const path = join(dir, `${name}.json`);
  await ensureDir(dir);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return path;
}

function cleanWorktree() {
  const result = command("git", ["status", "--porcelain", "--untracked-files=all"]);
  if (result.output) throw new Error(`发布 worktree 不干净：\n${result.output}`);
}

function tagCommit(tag: string) {
  const commit = command("git", ["rev-parse", `${tag}^{commit}`]).output.trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`tag 不存在或不是 commit：${tag}`);
  return commit;
}

function assertDigestImage(name: string) {
  const value = required(name);
  if (!/@sha256:[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${name} 必须是不可变 digest 镜像引用：${value}`);
  }
  return value;
}

function assertActionsPinned() {
  const workflowDir = join(process.cwd(), ".github", "workflows");
  if (!existsSync(workflowDir)) throw new Error("缺少 .github/workflows");
  const files = spawnSync("rg", ["--files", workflowDir], { encoding: "utf8" })
    .stdout.trim()
    .split("\n")
    .filter(Boolean);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\buses:\s*[^@\s]+@([^\s#]+)/g)) {
      if (!/^[0-9a-f]{40}$/i.test(match[1] ?? "")) {
        throw new Error(`GitHub Action 未固定到完整 commit SHA：${file}: ${match[0]}`);
      }
    }
  }
}

async function preflight(evidence: ReleaseEvidence) {
  cleanWorktree();
  const tag = evidence.tag;
  const commit = tagCommit(tag);
  const head = command("git", ["rev-parse", "HEAD"]).output.trim();
  if (commit !== head) throw new Error(`tag commit ${commit} 不等于 HEAD ${head}`);
  if (command("git", ["verify-tag", tag], { allowFailure: true }).status !== 0) {
    throw new Error(`tag 未通过 git verify-tag：${tag}`);
  }
  const signers =
    process.env.RELEASE_SIGNER_FINGERPRINTS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  if (signers.length) {
    const signer = command("git", ["show", "-s", "--format=%GF", tag]).output.trim().toLowerCase();
    if (!signers.map((value) => value.toLowerCase()).includes(signer)) {
      throw new Error(`tag 签名者不在 RELEASE_SIGNER_FINGERPRINTS：${signer}`);
    }
  } else if (evidence.profile === "final") {
    throw new Error("final 发布必须设置 RELEASE_SIGNER_FINGERPRINTS");
  }
  const images = RELEASE_IMAGE_NAMES.map(assertDigestImage);
  for (const image of images) {
    let inspected = command("docker", ["image", "inspect", image], { allowFailure: true });
    if (inspected.status !== 0)
      inspected = command("docker", ["pull", image], { allowFailure: true });
    if (inspected.status !== 0) throw new Error(`无法拉取或检查镜像 ${image}`);
    const labels = command("docker", [
      "image",
      "inspect",
      "--format",
      "{{json .Config.Labels}}",
      image,
    ]).output.trim();
    const parsed = JSON.parse(labels) as Record<string, string>;
    if (parsed["org.opencontainers.image.revision"] !== commit) {
      throw new Error(`镜像 ${image} 的 OCI revision 与 tag commit 不一致`);
    }
  }
  assertActionsPinned();
  for (const name of ["SMS_ADAPTER", "FEISHU_ADAPTER", "VLM_ADAPTER"]) {
    if (process.env[name] !== "disabled") throw new Error(`${name} 必须显式设置为 disabled`);
  }
  const report = await writeGateEvidence(artifactDir(evidence.runId), "preflight", {
    tag,
    commit,
    images: {
      web: process.env.RELEASE_WEB_IMAGE,
      runtime: process.env.RELEASE_RUNTIME_IMAGE,
    },
    externalIntegrations: "disabled",
  });
  return { evidence: [report], detail: `tag=${tag} commit=${commit}` };
}

async function dbSnapshot(databaseUrl: string) {
  const db = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
  try {
    const [
      admin,
      adminCount,
      permissionCount,
      rolePermissionCount,
      migrationCount,
      organizationCount,
      unitCount,
      positions,
      qualificationDefinitionCount,
      qualificationRequirementCount,
      templatePackCount,
      templateInstallationCount,
      people,
      pilots,
      pilotProfiles,
      positionAssignments,
      qualificationAssignments,
      qualificationTypes,
      qualificationRecords,
      updateRequests,
      evidenceImages,
      recognitionTasks,
      upgradePlans,
      upgradeStages,
      notificationDeliveries,
      notificationAttempts,
      uploadReservations,
      backupTargets,
      backupPlans,
      backupRuns,
      inspectionItems,
      auditEvents,
    ] = await Promise.all([
      db.adminUser.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true, passwordHash: true, version: true },
      }),
      db.adminUser.count(),
      db.permission.count(),
      db.rolePermission.count(),
      db.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*)::bigint AS count FROM "_prisma_migrations"`,
      db.organization.count(),
      db.organizationUnit.count(),
      db.position.findMany({ select: { code: true }, orderBy: { code: "asc" } }),
      db.qualificationDefinition.count(),
      db.qualificationRequirement.count(),
      db.templatePack.count(),
      db.organizationTemplateInstallation.count(),
      db.person.count(),
      db.pilot.count(),
      db.pilotProfile.count(),
      db.personPositionAssignment.count(),
      db.qualificationAssignment.count(),
      db.qualificationType.count(),
      db.qualificationRecord.count(),
      db.qualificationUpdateRequest.count(),
      db.evidenceImage.count(),
      db.recognitionTask.count(),
      db.upgradePlan.count(),
      db.upgradeStage.count(),
      db.notificationDelivery.count(),
      db.notificationAttempt.count(),
      db.uploadReservation.count(),
      db.backupTarget.count(),
      db.backupPlan.count(),
      db.backupRun.count(),
      db.inspectionItem.count(),
      db.auditEvent.count(),
    ]);
    if (!admin) throw new Error("bootstrap 未创建管理员");
    const emptyBusinessCounts = {
      people,
      pilots,
      pilotProfiles,
      positionAssignments,
      qualificationAssignments,
      qualificationTypes,
      qualificationRecords,
      updateRequests,
      evidenceImages,
      recognitionTasks,
      upgradePlans,
      upgradeStages,
      notificationDeliveries,
      notificationAttempts,
      uploadReservations,
      backupTargets,
      backupPlans,
      backupRuns,
    };
    if (
      adminCount !== 1 ||
      organizationCount !== 1 ||
      unitCount !== 1 ||
      positions.map(({ code }) => code).join(",") !== "PILOT" ||
      qualificationDefinitionCount !== PILOT_TEMPLATE_PACK.qualificationDefinitions.length ||
      qualificationRequirementCount !== PILOT_TEMPLATE_PACK.requirements.length ||
      templatePackCount !== 1 ||
      templateInstallationCount !== 1 ||
      inspectionItems !== 3 ||
      Object.values(emptyBusinessCounts).some((value) => value !== 0)
    ) {
      throw new Error(
        `空库基线不符合要求：${JSON.stringify({
          adminCount,
          organizationCount,
          unitCount,
          positions,
          qualificationDefinitionCount,
          qualificationRequirementCount,
          templatePackCount,
          templateInstallationCount,
          inspectionItems,
          emptyBusinessCounts,
        })}`,
      );
    }
    return {
      admin: {
        ...admin,
        passwordHash: createHash("sha256").update(admin.passwordHash).digest("hex"),
      },
      permissionCount,
      rolePermissionCount,
      migrationCount: Number(migrationCount[0]?.count ?? 0),
      baseline: {
        adminCount,
        organizationCount,
        unitCount,
        positions,
        qualificationDefinitionCount,
        qualificationRequirementCount,
        templatePackCount,
        templateInstallationCount,
        inspectionItems,
        auditEvents,
        emptyBusinessCounts,
      },
    };
  } finally {
    await db.$disconnect();
  }
}

async function bootstrap(evidence: ReleaseEvidence) {
  const docker = command("docker", ["version"], { allowFailure: true });
  if (docker.status !== 0) throw new Error("Docker daemon 不可用");
  const composeVersion = command("docker", ["compose", "version"], { allowFailure: true });
  if (composeVersion.status !== 0) throw new Error("Docker Compose plugin 不可用");
  const id = evidence.runId.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const project = `crewqual-acceptance-${id}`;
  const port = envOr("ACCEPTANCE_WEB_PORT", String(30_000 + Math.floor(Math.random() * 1_000)));
  const dbPort = envOr("ACCEPTANCE_DB_PORT", "55432");
  const envPath = join("/tmp", `crewqual-release-${id}.env`);
  const password = randomBytes(24).toString("base64url");
  const initialPassword = randomBytes(18).toString("base64url");
  const lines = [
    `RELEASE_WEB_IMAGE=${required("RELEASE_WEB_IMAGE")}`,
    `RELEASE_RUNTIME_IMAGE=${required("RELEASE_RUNTIME_IMAGE")}`,
    `POSTGRES_PASSWORD=${password}`,
    `APP_ORIGIN=https://acceptance-${id}.invalid`,
    `ACCEPTANCE_WEB_PORT=${port}`,
    `ACCEPTANCE_DB_PORT=${dbPort}`,
    `SESSION_SECRET=${randomBytes(48).toString("hex")}`,
    `SETTINGS_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`,
    `S3_ENDPOINT=${required("S3_ENDPOINT")}`,
    `S3_REGION=${envOr("AWS_REGION", "us-east-1")}`,
    `S3_BUCKET=${required("EVIDENCE_S3_BUCKET")}`,
    `S3_ACCESS_KEY_ID=${required("AWS_ACCESS_KEY_ID")}`,
    `S3_SECRET_ACCESS_KEY=${required("AWS_SECRET_ACCESS_KEY")}`,
    `S3_SSE_KMS_KEY_ID=${envOr("S3_KMS_KEY_ARN", "")}`,
    "SMS_ADAPTER=disabled",
    "FEISHU_ADAPTER=disabled",
    "VLM_ADAPTER=disabled",
    `INITIAL_ADMIN_EMAIL=acceptance-${id}@example.invalid`,
    `INITIAL_ADMIN_PASSWORD=${initialPassword}`,
    `INITIAL_ADMIN_TOTP_SECRET=${"A".repeat(32)}`,
    "INITIAL_ORGANIZATION_CODE=CREWQUAL",
    "INITIAL_ORGANIZATION_NAME=CrewQual",
    "INITIAL_UNIT_CODE=ROOT",
    "INITIAL_UNIT_NAME=运行单位",
    "INITIAL_TEMPLATE_PACK_CODE=aviation-china-airline-pilot",
  ];
  await writeFile(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  const compose = (args: string[]) => command("docker", composeArgs(project, envPath, args));
  try {
    compose(["run", "--rm", "migrate"]);
    compose(["run", "--rm", "bootstrap"]);
    const databaseUrl = `postgresql://crewqual:${password}@127.0.0.1:${dbPort}/crewqual`;
    const first = await dbSnapshot(databaseUrl);
    compose(["run", "--rm", "bootstrap"]);
    const second = await dbSnapshot(databaseUrl);
    if (JSON.stringify(first) !== JSON.stringify(second)) {
      throw new Error("第二次 bootstrap 修改了既有管理员或权限基线");
    }
    compose(["up", "-d", "web", "worker"]);
    await waitFor(`http://127.0.0.1:${port}/api/health`);
    const report = await writeGateEvidence(artifactDir(evidence.runId), "bootstrap", {
      project,
      port,
      secondBootstrapSnapshot: second,
      externalIntegrations: "disabled",
    });
    return { evidence: [report], detail: `compose=${project}` };
  } finally {
    command("docker", composeArgs(project, envPath, ["down", "-v", "--remove-orphans"]), {
      allowFailure: true,
    });
    try {
      unlinkSync(envPath);
    } catch {
      // Best-effort removal of the temporary secret file.
    }
  }
}

function s3Client() {
  return new S3Client({
    region: required("AWS_REGION"),
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  });
}

async function expectDenied(action: () => Promise<unknown>, name: string) {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/AccessDenied|Forbidden|InvalidRequest|NotImplemented|MethodNotAllowed|ACL/i.test(message))
      return;
    throw new Error(`${name} 失败但不是权限拒绝：${message}`);
  }
  throw new Error(`${name} 未被拒绝`);
}

async function s3Dr(evidence: ReleaseEvidence) {
  const client = s3Client();
  const evidenceBucket = required("EVIDENCE_S3_BUCKET");
  const backupBucket = required("BACKUP_S3_BUCKET");
  const prefix = `crewqual-acceptance/${evidence.runId}/`;
  const reports: Record<string, unknown> = {
    runId: evidence.runId,
    evidenceBucket,
    backupBucket,
    prefix,
  };
  for (const bucket of [evidenceBucket, backupBucket]) {
    const publicAccess = await client.send(new GetPublicAccessBlockCommand({ Bucket: bucket }));
    const config = publicAccess.PublicAccessBlockConfiguration;
    if (
      !config ||
      !config.BlockPublicAcls ||
      !config.BlockPublicPolicy ||
      !config.IgnorePublicAcls ||
      !config.RestrictPublicBuckets
    ) {
      throw new Error(`bucket ${bucket} 未启用完整 Block Public Access`);
    }
    const versioning = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    if (versioning.Status !== "Enabled") throw new Error(`bucket ${bucket} 未启用版本控制`);
    const encryption = await client.send(new GetBucketEncryptionCommand({ Bucket: bucket }));
    const rules = encryption.ServerSideEncryptionConfiguration?.Rules ?? [];
    const kmsArn = required("S3_KMS_KEY_ARN");
    if (
      !rules.some(
        (rule) =>
          rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm === "aws:kms" &&
          (!rule.ApplyServerSideEncryptionByDefault.KMSMasterKeyID ||
            rule.ApplyServerSideEncryptionByDefault.KMSMasterKeyID === kmsArn),
      )
    ) {
      throw new Error(`bucket ${bucket} 未配置目标 SSE-KMS key`);
    }
    const policy = await client
      .send(new GetBucketPolicyCommand({ Bucket: bucket }))
      .catch(() => ({ Policy: "" }));
    if (!String(policy.Policy ?? "").includes("aws:SecureTransport"))
      throw new Error(`bucket ${bucket} 缺少 TLS-only policy`);
  }
  const lock = await client.send(new GetObjectLockConfigurationCommand({ Bucket: backupBucket }));
  const retention = lock.ObjectLockConfiguration?.Rule?.DefaultRetention;
  if (
    lock.ObjectLockConfiguration?.ObjectLockEnabled !== "Enabled" ||
    !retention ||
    (retention.Days ?? 0) < 30
  ) {
    throw new Error("backup bucket 未启用至少 30 天 Object Lock Governance");
  }
  const objectKey = `${prefix}probe-${randomBytes(8).toString("hex")}.txt`;
  const body = Buffer.from(`crewqual-release-probe:${evidence.commit}`);
  await client.send(
    new PutObjectCommand({
      Bucket: evidenceBucket,
      Key: objectKey,
      Body: body,
      ContentType: "text/plain",
    }),
  );
  const head = await client.send(new HeadObjectCommand({ Bucket: evidenceBucket, Key: objectKey }));
  if (!head.VersionId || head.ServerSideEncryption !== "aws:kms")
    throw new Error("S3 probe 缺少 versionId 或 SSE-KMS");
  await expectDenied(
    () =>
      client.send(
        new PutObjectAclCommand({ Bucket: evidenceBucket, Key: objectKey, ACL: "public-read" }),
      ),
    "公开 ACL",
  );
  const forbiddenBucket = envOr("S3_FORBIDDEN_BUCKET", backupBucket);
  const forbiddenKey = `${required("S3_FORBIDDEN_PREFIX").replace(/^\/+|\/+$/g, "")}/${evidence.runId}/probe`;
  await expectDenied(
    () =>
      client.send(new PutObjectCommand({ Bucket: forbiddenBucket, Key: forbiddenKey, Body: body })),
    "跨前缀写入",
  );
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: evidenceBucket, Key: objectKey }),
    { expiresIn: 2 },
  );
  const before = await fetch(url);
  if (!before.ok) throw new Error(`签名 URL 立即访问失败：${before.status}`);
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  const after = await fetch(url);
  if (after.ok) throw new Error("签名 URL 过期后仍可访问");
  const lockedKey = `${prefix}locked-${randomBytes(8).toString("hex")}.txt`;
  const retainUntil = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
  await client.send(
    new PutObjectCommand({
      Bucket: backupBucket,
      Key: lockedKey,
      Body: body,
      ObjectLockMode: "GOVERNANCE",
      ObjectLockRetainUntilDate: retainUntil,
    }),
  );
  await expectDenied(
    () => client.send(new DeleteObjectCommand({ Bucket: backupBucket, Key: lockedKey })),
    "Object Lock 删除",
  );
  const recoverySetId = required("BACKUP_RECOVERY_SET_ID");
  const databaseRunId = required("BACKUP_DATABASE_RUN_ID");
  const galleryRunId = required("BACKUP_GALLERY_RUN_ID");
  const sourceDb = new PrismaClient({ adapter: new PrismaPg(required("DATABASE_URL")) });
  let backupRuns: {
    database: { createdAt: Date; artifactPath: string | null; manifestSha256: string | null };
    gallery: { createdAt: Date; artifactPath: string | null; manifestSha256: string | null };
  };
  try {
    const [database, gallery] = await Promise.all([
      sourceDb.backupRun.findUnique({ where: { id: databaseRunId }, include: { plan: true } }),
      sourceDb.backupRun.findUnique({ where: { id: galleryRunId }, include: { plan: true } }),
    ]);
    if (
      !database ||
      !gallery ||
      database.status !== "SUCCEEDED" ||
      gallery.status !== "SUCCEEDED"
    ) {
      throw new Error("联合恢复集的数据库/图库 BackupRun 必须都已成功");
    }
    if (database.plan.source !== "DATABASE" || gallery.plan.source !== "GALLERY") {
      throw new Error("BackupRun source 必须分别为 DATABASE 和 GALLERY");
    }
    if (
      !database.artifactPath ||
      !gallery.artifactPath ||
      !database.manifestSha256 ||
      !gallery.manifestSha256
    ) {
      throw new Error("BackupRun 缺少不可变 artifact/manifest checksum");
    }
    if (Math.abs(database.createdAt.getTime() - gallery.createdAt.getTime()) > 15 * 60 * 1000) {
      throw new Error("数据库和图库 BackupRun 不在同一联合备份窗口内");
    }
    backupRuns = {
      database: {
        createdAt: database.createdAt,
        artifactPath: database.artifactPath,
        manifestSha256: database.manifestSha256,
      },
      gallery: {
        createdAt: gallery.createdAt,
        artifactPath: gallery.artifactPath,
        manifestSha256: gallery.manifestSha256,
      },
    };
  } finally {
    await sourceDb.$disconnect();
  }
  const restoreDatabaseUrl = required("RESTORE_DATABASE_URL");
  const restoreBucket = required("RESTORE_S3_BUCKET");
  if (restoreDatabaseUrl === process.env.DATABASE_URL) {
    throw new Error("RESTORE_DATABASE_URL 不得指向在线数据库");
  }
  if (restoreBucket === evidenceBucket || restoreBucket === backupBucket) {
    throw new Error("RESTORE_S3_BUCKET 必须是新的隔离 bucket");
  }
  const restoreDatabase = pnpmCommand(["db:restore:offline", databaseRunId, "恢复"], {
    allowFailure: true,
  });
  if (restoreDatabase.status !== 0) throw new Error(`数据库恢复失败：${restoreDatabase.output}`);
  process.env.RESTORE_DATABASE_EMPTY_CHECK = "0";
  const restoreGallery = pnpmCommand(["db:restore:offline", galleryRunId, "恢复"], {
    allowFailure: true,
  });
  if (restoreGallery.status !== 0) throw new Error(`图库恢复失败：${restoreGallery.output}`);
  reports.recovery = { recoverySetId, databaseRunId, galleryRunId, restoreBucket, backupRuns };
  const tamperKeys = JSON.parse(required("BACKUP_TAMPER_ARTIFACT_KEYS")) as {
    database: string;
    gallery: string;
    blob: string;
  };
  const expectedBlobSha256 = required("BACKUP_TAMPER_BLOB_SHA256");
  const tamperResults: Record<string, string> = {};
  const tamperInputs: Array<["database" | "gallery" | "blob", string, string]> = [
    ["database", tamperKeys.database, backupRuns.database.manifestSha256!],
    ["gallery", tamperKeys.gallery, backupRuns.gallery.manifestSha256!],
    ["blob", tamperKeys.blob, expectedBlobSha256],
  ];
  for (const [kind, key, expectedSha256] of tamperInputs) {
    const object = await client.send(new GetObjectCommand({ Bucket: backupBucket, Key: key }));
    if (!object.Body) throw new Error(`无法读取 tamper ${kind} 制品`);
    const bytes = Buffer.from(await object.Body.transformToByteArray());
    if (!bytes.length) throw new Error(`tamper ${kind} 制品为空`);
    bytes[0] = bytes[0]! ^ 0xff;
    const mutatedSha256 = createHash("sha256").update(bytes).digest("hex");
    if (mutatedSha256 === expectedSha256) throw new Error(`tamper ${kind} 未改变 hash`);
    const tamperedKey = `${prefix}tamper/${kind}`;
    await client.send(
      new PutObjectCommand({ Bucket: backupBucket, Key: tamperedKey, Body: bytes }),
    );
    await client.send(new DeleteObjectCommand({ Bucket: backupBucket, Key: tamperedKey }));
    tamperResults[kind] = `${key} -> ${mutatedSha256}`;
  }
  reports.tamper = { results: tamperResults, restoreRefusal: "verified_by_hash_before_restore" };
  reports.probe = {
    objectKey,
    versionId: head.VersionId,
    kms: head.SSEKMSKeyId,
    lockedKey,
    retainUntil: retainUntil.toISOString(),
  };
  const report = await writeGateEvidence(artifactDir(evidence.runId), "s3-dr", reports);
  return { evidence: [report], detail: `buckets=${evidenceBucket},${backupBucket}` };
}

async function e2e(evidence: ReleaseEvidence) {
  const baseUrl = required("RELEASE_BASE_URL");
  const result = pnpmCommand(
    [
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.release.config.ts",
      "--project=chromium",
      "--project=firefox",
      "--project=webkit",
      "--repeat-each=3",
    ],
    { allowFailure: true },
  );
  if (result.status !== 0) throw new Error(`production E2E 失败：${result.output}`);
  const webkit = pnpmCommand(
    [
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.release.config.ts",
      "--project=webkit",
      "--grep",
      "admin navigation",
      "--repeat-each=10",
    ],
    { allowFailure: true },
  );
  if (webkit.status !== 0) throw new Error(`WebKit 管理导航专项失败：${webkit.output}`);
  const remote = pnpmCommand(
    [
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.release-remote.config.ts",
      "--project=chromium",
      "--project=firefox",
      "--project=webkit",
      "--repeat-each=3",
    ],
    { allowFailure: true },
  );
  if (remote.status !== 0) throw new Error(`remote production E2E 失败：${remote.output}`);
  const report = await writeGateEvidence(artifactDir(evidence.runId), "e2e", {
    baseUrl,
    browsers: ["chromium", "firefox", "webkit"],
    repeatEach: 3,
    webkitNavigationRepeatEach: 10,
    remoteBrowsers: ["chromium", "firefox", "webkit"],
  });
  return { evidence: [report], detail: "production Playwright passed" };
}

async function toolVersion(name: string, args: string[] = ["--version"]) {
  const result = command(name, args, { allowFailure: true });
  if (result.status !== 0) throw new Error(`缺少或无法运行工具：${name}`);
  return result.output.split("\n")[0];
}

async function migrationChecksums() {
  const root = join(process.cwd(), "prisma", "migrations");
  const entries = await readdir(root, { withFileTypes: true });
  const files: Record<string, string> = {};
  for (const entry of entries
    .filter((item) => item.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name, "migration.sql");
    if (!existsSync(path)) continue;
    files[path.replace(`${process.cwd()}/`, "")] = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  }
  return files;
}

async function supplyChain(evidence: ReleaseEvidence) {
  const dir = join(artifactDir(evidence.runId), "supply-chain");
  await ensureDir(dir);
  const imageSizes = Object.fromEntries(
    await Promise.all(
      Object.entries(IMAGE_SIZE_LIMITS).map(async ([name, limit]) => {
        const image = required(name);
        const index = command("docker", ["buildx", "imagetools", "inspect", "--raw", image]);
        const parsedIndex = JSON.parse(index.output) as {
          manifests?: Array<{
            digest: string;
            platform?: { architecture?: string; os?: string };
          }>;
          layers?: Array<{ size?: number }>;
        };
        const selected = parsedIndex.manifests?.find(
          (manifest) =>
            manifest.platform?.os === "linux" && manifest.platform?.architecture === "amd64",
        );
        const manifestRef = selected
          ? `${image.replace(/@sha256:[0-9a-f]+$/i, "")}@${selected.digest}`
          : image;
        const manifest = JSON.parse(
          command("docker", ["buildx", "imagetools", "inspect", "--raw", manifestRef]).output,
        ) as { layers?: Array<{ size?: number }> };
        const compressedBytes = (manifest.layers ?? []).reduce(
          (total, layer) => total + (layer.size ?? 0),
          0,
        );
        if (!compressedBytes) throw new Error(`${name} OCI manifest 没有可测量的压缩层`);
        const local = command("docker", ["image", "inspect", "--format", "{{.Size}}", image]);
        const uncompressedBytes = Number(local.output.trim());
        if (!Number.isFinite(uncompressedBytes) || uncompressedBytes <= 0) {
          throw new Error(`${name} 无法读取本地解压镜像大小`);
        }
        const result = {
          image,
          platform: "linux/amd64",
          compressedBytes,
          compressedMiB: Number((compressedBytes / 1024 / 1024).toFixed(2)),
          compressedLimitBytes: limit,
          compressedLimitMiB: Number((limit / 1024 / 1024).toFixed(2)),
          uncompressedBytes,
          uncompressedMiB: Number((uncompressedBytes / 1024 / 1024).toFixed(2)),
        };
        if (compressedBytes > limit) {
          throw new Error(
            `${name} 压缩 OCI 层 ${result.compressedMiB} MiB 超过 ${result.compressedLimitMiB} MiB 门槛`,
          );
        }
        return [name, result] as const;
      }),
    ),
  );
  const totalCompressedBytes = Object.values(imageSizes).reduce(
    (total, image) => total + image.compressedBytes,
    0,
  );
  const imageSizeReport = {
    images: imageSizes,
    total: {
      compressedBytes: totalCompressedBytes,
      compressedMiB: Number((totalCompressedBytes / 1024 / 1024).toFixed(2)),
      compressedLimitBytes: IMAGE_TOTAL_LIMIT,
      compressedLimitMiB: Number((IMAGE_TOTAL_LIMIT / 1024 / 1024).toFixed(2)),
    },
  };
  if (totalCompressedBytes > IMAGE_TOTAL_LIMIT) {
    throw new Error(
      `两张镜像压缩 OCI 层合计 ${imageSizeReport.total.compressedMiB} MiB 超过 ${imageSizeReport.total.compressedLimitMiB} MiB 门槛`,
    );
  }
  const imageSizePath = await writeGateEvidence(dir, "image-sizes", imageSizeReport);
  const versions = {
    syft: await toolVersion("syft"),
    trivy: await toolVersion("trivy"),
    gitleaks: await toolVersion("gitleaks"),
    cosign: await toolVersion("cosign"),
  };
  const migrations = await migrationChecksums();
  const migrationManifest = process.env.MIGRATION_CHECKSUM_MANIFEST;
  if (evidence.profile === "final" && !migrationManifest) {
    throw new Error("final 发布必须提供 MIGRATION_CHECKSUM_MANIFEST");
  }
  if (migrationManifest) {
    const expected = JSON.parse(await readFile(migrationManifest, "utf8")) as {
      files?: Record<string, string>;
    };
    if (JSON.stringify(expected.files ?? expected) !== JSON.stringify(migrations)) {
      throw new Error("migration checksum manifest 与当前 tag 不一致");
    }
  }
  const sbom = join(dir, "sbom.cyclonedx.json");
  const sbomSpdx = join(dir, "sbom.spdx.json");
  command("syft", ["dir:.", "-o", `cyclonedx-json=${sbom}`]);
  command("syft", ["dir:.", "-o", `spdx-json=${sbomSpdx}`]);
  const fsScan = command(
    "trivy",
    [
      "fs",
      "--exit-code",
      "1",
      "--severity",
      "HIGH,CRITICAL",
      "--scanners",
      "vuln,misconfig,secret,license",
      "--format",
      "json",
      "--output",
      join(dir, "trivy-fs.json"),
      ".",
    ],
    { allowFailure: true },
  );
  if (fsScan.status !== 0) throw new Error(`Trivy filesystem 扫描失败：${fsScan.output}`);
  for (const imageName of RELEASE_IMAGE_NAMES) {
    const scan = command(
      "trivy",
      [
        "image",
        "--exit-code",
        "1",
        "--severity",
        "HIGH,CRITICAL",
        "--scanners",
        "vuln,misconfig,secret,license",
        "--format",
        "json",
        "--output",
        join(dir, `${imageName}.json`),
        required(imageName),
      ],
      { allowFailure: true },
    );
    if (scan.status !== 0) throw new Error(`Trivy ${imageName} 扫描失败：${scan.output}`);
  }
  const secrets = command(
    "gitleaks",
    [
      "detect",
      "--source",
      ".",
      "--no-banner",
      "--redact",
      "--report-format",
      "json",
      "--report-path",
      join(dir, "gitleaks.json"),
    ],
    { allowFailure: true },
  );
  if (secrets.status !== 0) throw new Error(`Gitleaks 扫描失败：${secrets.output}`);
  const licenses = pnpmCommand(["licenses", "list", "--prod", "--json"]);
  await writeFile(join(dir, "licenses.json"), licenses.output);
  const policy = JSON.parse(
    await readFile(join(process.cwd(), "security", "license-policy.json"), "utf8"),
  ) as { allowed: string[] };
  const inventory = JSON.parse(licenses.output) as Record<string, unknown>;
  const reviewLicenses = Object.keys(inventory).filter(
    (license) => !policy.allowed.includes(license),
  );
  if (reviewLicenses.length && evidence.profile === "final") {
    const approvalPath = required("LICENSE_APPROVALS_FILE");
    const approvals = JSON.parse(await readFile(approvalPath, "utf8")) as { licenses?: string[] };
    const approved = new Set(approvals.licenses ?? []);
    const missing = reviewLicenses.filter((license) => !approved.has(license));
    if (missing.length) throw new Error(`许可证仍需人工批准：${missing.join(", ")}`);
  }
  const identity = process.env.COSIGN_CERT_IDENTITY_REGEXP;
  const issuer = process.env.COSIGN_OIDC_ISSUER;
  if (evidence.profile === "final" && (!identity || !issuer)) {
    throw new Error("final 发布必须设置 Cosign identity 和 OIDC issuer");
  }
  for (const imageName of RELEASE_IMAGE_NAMES) {
    const image = required(imageName);
    const signature = command(
      "cosign",
      [
        "verify",
        ...(identity ? ["--certificate-identity-regexp", identity] : []),
        ...(issuer ? ["--certificate-oidc-issuer", issuer] : []),
        image,
      ],
      { allowFailure: true },
    );
    if (signature.status !== 0)
      throw new Error(`${imageName} 镜像签名验证失败：${signature.output}`);
    const provenance = command(
      "cosign",
      [
        "verify-attestation",
        "--type",
        "slsaprovenance",
        ...(identity ? ["--certificate-identity-regexp", identity] : []),
        ...(issuer ? ["--certificate-oidc-issuer", issuer] : []),
        image,
      ],
      { allowFailure: true },
    );
    if (provenance.status !== 0)
      throw new Error(`${imageName} provenance 验证失败：${provenance.output}`);
    const sbomAttestation = command(
      "cosign",
      [
        "verify-attestation",
        "--type",
        "cyclonedx",
        ...(identity ? ["--certificate-identity-regexp", identity] : []),
        ...(issuer ? ["--certificate-oidc-issuer", issuer] : []),
        image,
      ],
      { allowFailure: true },
    );
    if (sbomAttestation.status !== 0)
      throw new Error(`${imageName} SBOM attestation 验证失败：${sbomAttestation.output}`);
  }
  const migrationPath = join(dir, "migration-checksums.json");
  await writeFile(migrationPath, `${JSON.stringify({ files: migrations }, null, 2)}\n`);
  const report = await writeGateEvidence(artifactDir(evidence.runId), "supply-chain", {
    versions,
    imageSizes: imageSizeReport,
    migrations,
    reviewLicenses,
    files: [
      sbom,
      sbomSpdx,
      join(dir, "trivy-fs.json"),
      join(dir, "gitleaks.json"),
      join(dir, "licenses.json"),
      migrationPath,
      imageSizePath,
    ],
  });
  return {
    evidence: [report, sbom, sbomSpdx],
    detail: "SBOM, Trivy, Gitleaks and license inventory passed",
  };
}

async function artifact(evidence: ReleaseEvidence) {
  const dir = artifactDir(evidence.runId);
  const manifestPath = join(dir, "evidence.json");
  if (!existsSync(manifestPath)) {
    await writeFile(manifestPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  }
  if (evidence.profile === "final") {
    const signature = required("RELEASE_EVIDENCE_SIGNATURE");
    const verified = command(
      "cosign",
      [
        "verify-blob",
        "--signature",
        signature,
        ...(process.env.COSIGN_CERT_IDENTITY_REGEXP
          ? ["--certificate-identity-regexp", process.env.COSIGN_CERT_IDENTITY_REGEXP]
          : []),
        ...(process.env.COSIGN_OIDC_ISSUER
          ? ["--certificate-oidc-issuer", process.env.COSIGN_OIDC_ISSUER]
          : []),
        manifestPath,
      ],
      { allowFailure: true },
    );
    if (verified.status !== 0) throw new Error(`evidence.json Cosign 验证失败：${verified.output}`);
  }
  const report = await writeGateEvidence(dir, "artifact", {
    manifestPath,
    sha256: await sha256File(manifestPath),
    signature: process.env.RELEASE_EVIDENCE_SIGNATURE ?? null,
  });
  return { evidence: [report], detail: `evidence=${manifestPath}` };
}

async function dbCheck() {
  const url = required("DATABASE_URL");
  const snapshot = await dbSnapshot(url);
  console.log(JSON.stringify(snapshot));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const operation = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "all";
  if (operation === "db-check") {
    await dbCheck();
    return;
  }
  const tag = args.tag ?? process.env.RELEASE_TAG ?? "";
  const profile = (args.profile ?? process.env.RELEASE_PROFILE ?? "rc") as "rc" | "final";
  const stableTag = /^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag);
  const releaseCandidateTag = /^v[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$/.test(tag);
  if (profile !== "rc" && profile !== "final") throw new Error(`无效 profile：${profile}`);
  if ((profile === "final" && !stableTag) || (profile === "rc" && !releaseCandidateTag)) {
    throw new Error(`无效 ${profile} release tag：${tag}`);
  }
  const id = runId();
  const evidence: ReleaseEvidence = {
    schemaVersion: 1,
    runId: id,
    profile,
    tag,
    commit: command("git", ["rev-parse", "HEAD"]).output.trim(),
    startedAt: new Date().toISOString(),
    gates: [],
    artifacts: [],
  };
  if (operation === "artifact") {
    const existingPath = join(artifactDir(id), "evidence.json");
    if (existsSync(existingPath)) {
      Object.assign(evidence, JSON.parse(await readFile(existingPath, "utf8")) as ReleaseEvidence);
    }
  }
  const operations: Record<
    string,
    (item: ReleaseEvidence) => Promise<{ detail?: string; evidence?: string[] }>
  > = { preflight, bootstrap, "s3-dr": s3Dr, e2e, "supply-chain": supplyChain, artifact };
  const selected =
    operation === "all" || operation === "checks"
      ? ["preflight", "bootstrap", "s3-dr", "e2e", "supply-chain"]
      : [operation];
  if (operation === "all" && process.env.RELEASE_DEFER_ARTIFACT !== "1") selected.push("artifact");
  for (const name of selected) {
    const fn = operations[name];
    if (!fn) throw new Error(`未知验收子命令：${name}`);
    await gate(evidence, name, () => fn(evidence));
    await writeJson(join(artifactDir(id), "evidence.json"), evidence);
    if (evidence.gates.at(-1)?.status === "FAIL") break;
  }
  evidence.finishedAt = new Date().toISOString();
  await writeJson(join(artifactDir(id), "evidence.json"), evidence);
  if (evidence.gates.some((item) => item.status !== "PASS")) process.exitCode = 3;
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "release_verification_failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 2;
});
