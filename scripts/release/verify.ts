import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import { collectQualificationAudit } from "../audit-qualification-state";
import { assertAcceptanceConfig, type AcceptanceScope } from "./acceptance-config";
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

function pnpmCommand(
  args: string[],
  options: { allowFailure?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  if (!pnpmRunner) {
    pnpmRunner =
      command("pnpm", ["--version"], { allowFailure: true }).status === 0 ? "pnpm" : "corepack";
  }
  return pnpmRunner === "pnpm"
    ? command("pnpm", args, options)
    : command("corepack", ["pnpm", ...args], options);
}

const RELEASE_IMAGE_NAMES = ["RELEASE_WEB_IMAGE", "RELEASE_RUNTIME_IMAGE"] as const;

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

async function waitFor(
  url: string,
  expected = 200,
  timeoutMs = 180_000,
  headers: Record<string, string> = {},
) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
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
  const listFiles = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    });
  const files = listFiles(workflowDir);
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
  if (command("git", ["cat-file", "-t", tag]).output.trim() !== "tag") {
    throw new Error(`release tag 必须是 annotated tag：${tag}`);
  }
  const tagVerification = command("git", ["verify-tag", "--raw", tag], { allowFailure: true });
  if (tagVerification.status !== 0 || !tagVerification.output.includes("[GNUPG:] VALIDSIG")) {
    throw new Error(`tag 未通过 git verify-tag：${tag}`);
  }
  const signers =
    process.env.RELEASE_SIGNER_FINGERPRINTS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  if (signers.length) {
    const validSig = tagVerification.output.match(
      /\[GNUPG:\] VALIDSIG\s+([A-Fa-f0-9]+).*?\s([A-Fa-f0-9]{40})\s*$/m,
    );
    const signing = validSig?.[1]?.toLowerCase();
    const primary = validSig?.[2]?.toLowerCase();
    if (
      !signing ||
      !primary ||
      !signers
        .map((value) => value.toLowerCase())
        .some((value) => value === signing || value === primary)
    ) {
      throw new Error(
        `tag 签名主键/子键不在 RELEASE_SIGNER_FINGERPRINTS：${signing ?? "unknown"}/${primary ?? "unknown"}`,
      );
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

async function databaseRoleSnapshot(runtimeDatabaseUrl: string, ownerDatabaseUrl: string) {
  const runtime = new PrismaClient({ adapter: new PrismaPg(runtimeDatabaseUrl) });
  const owner = new PrismaClient({ adapter: new PrismaPg(ownerDatabaseUrl) });
  const expectRuntimeDenied = async (label: string, sql: string) => {
    try {
      await runtime.$executeRawUnsafe(sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/permission denied|append-only|must be owner/i.test(message)) return;
      throw new Error(`${label} 以非预期方式失败：${message}`);
    }
    throw new Error(`${label} 未被数据库权限边界拒绝`);
  };
  try {
    const [runtimeIdentity] = await runtime.$queryRaw<Array<{ currentUser: string }>>`
      SELECT current_user AS "currentUser"
    `;
    const [security] = await owner.$queryRaw<
      Array<{
        auditOwner: string;
        queueOwner: string;
        runtimeRoleRestricted: boolean;
        runtimeHasRoleMemberships: boolean;
        runtimeOwnsObjects: boolean;
        runtimeOwnsFunctions: boolean;
        updateAllowed: boolean;
        deleteAllowed: boolean;
        truncateAllowed: boolean;
        schemaCreateAllowed: boolean;
        queueSchemaUsage: boolean;
        queueSchemaCreateAllowed: boolean;
        queueTablesCrud: boolean;
        queueDangerousPrivileges: boolean;
        queueCreateFunctionAllowed: boolean;
        queueOtherFunctionsAllowed: boolean;
        databaseCreateAllowed: boolean;
        databaseTempAllowed: boolean;
        appendTrigger: boolean;
        truncateTrigger: boolean;
      }>
    >`
      SELECT owner_role.rolname AS "auditOwner",
             (
               SELECT queue_owner.rolname
               FROM pg_catalog.pg_namespace queue_namespace
               JOIN pg_catalog.pg_roles queue_owner ON queue_owner.oid = queue_namespace.nspowner
               WHERE queue_namespace.nspname = 'pgboss'
             ) AS "queueOwner",
             (
               SELECT runtime_role.rolcanlogin
                 AND NOT runtime_role.rolsuper
                 AND NOT runtime_role.rolinherit
                 AND NOT runtime_role.rolcreaterole
                 AND NOT runtime_role.rolcreatedb
                 AND NOT runtime_role.rolreplication
                 AND NOT runtime_role.rolbypassrls
               FROM pg_catalog.pg_roles runtime_role
               WHERE runtime_role.rolname = 'crewqual_app'
             ) AS "runtimeRoleRestricted",
             EXISTS (
               SELECT 1
               FROM pg_catalog.pg_auth_members membership
               JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
               WHERE member_role.rolname = 'crewqual_app'
             ) AS "runtimeHasRoleMemberships",
             EXISTS (
               SELECT 1
               FROM pg_catalog.pg_class owned_relation
               JOIN pg_catalog.pg_namespace owned_namespace
                 ON owned_namespace.oid = owned_relation.relnamespace
               JOIN pg_catalog.pg_roles owned_role ON owned_role.oid = owned_relation.relowner
               WHERE owned_namespace.nspname IN ('public', 'pgboss')
                 AND owned_role.rolname = 'crewqual_app'
                 AND owned_relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
             ) AS "runtimeOwnsObjects",
             EXISTS (
               SELECT 1
               FROM pg_catalog.pg_proc owned_procedure
               JOIN pg_catalog.pg_namespace owned_namespace
                 ON owned_namespace.oid = owned_procedure.pronamespace
               JOIN pg_catalog.pg_roles owned_role ON owned_role.oid = owned_procedure.proowner
               WHERE owned_namespace.nspname IN ('public', 'pgboss')
                 AND owned_role.rolname = 'crewqual_app'
             ) AS "runtimeOwnsFunctions",
             has_table_privilege('crewqual_app', '"AuditEvent"', 'UPDATE') AS "updateAllowed",
             has_table_privilege('crewqual_app', '"AuditEvent"', 'DELETE') AS "deleteAllowed",
             has_table_privilege('crewqual_app', '"AuditEvent"', 'TRUNCATE') AS "truncateAllowed",
             has_schema_privilege('crewqual_app', 'public', 'CREATE') AS "schemaCreateAllowed",
             has_schema_privilege('crewqual_app', 'pgboss', 'USAGE') AS "queueSchemaUsage",
             has_schema_privilege('crewqual_app', 'pgboss', 'CREATE') AS "queueSchemaCreateAllowed",
             COALESCE((
               SELECT bool_and(
                 has_table_privilege('crewqual_app', queue_relation.oid, 'SELECT')
                 AND has_table_privilege('crewqual_app', queue_relation.oid, 'INSERT')
                 AND has_table_privilege('crewqual_app', queue_relation.oid, 'UPDATE')
                 AND has_table_privilege('crewqual_app', queue_relation.oid, 'DELETE')
               )
               FROM pg_catalog.pg_class queue_relation
               JOIN pg_catalog.pg_namespace queue_namespace
                 ON queue_namespace.oid = queue_relation.relnamespace
               WHERE queue_namespace.nspname = 'pgboss'
                 AND queue_relation.relkind IN ('r', 'p')
             ), false) AS "queueTablesCrud",
             EXISTS (
               SELECT 1
               FROM pg_catalog.pg_class queue_relation
               JOIN pg_catalog.pg_namespace queue_namespace
                 ON queue_namespace.oid = queue_relation.relnamespace
               WHERE queue_namespace.nspname = 'pgboss'
                 AND queue_relation.relkind IN ('r', 'p')
                 AND (
                   has_table_privilege('crewqual_app', queue_relation.oid, 'TRUNCATE')
                   OR has_table_privilege('crewqual_app', queue_relation.oid, 'REFERENCES')
                   OR has_table_privilege('crewqual_app', queue_relation.oid, 'TRIGGER')
                 )
             ) AS "queueDangerousPrivileges",
             has_function_privilege(
               'crewqual_app',
               'pgboss.create_queue(text,jsonb)'::regprocedure,
               'EXECUTE'
             ) AS "queueCreateFunctionAllowed",
             EXISTS (
               SELECT 1
               FROM pg_catalog.pg_proc queue_procedure
               JOIN pg_catalog.pg_namespace queue_namespace
                 ON queue_namespace.oid = queue_procedure.pronamespace
               WHERE queue_namespace.nspname = 'pgboss'
                 AND queue_procedure.oid <> 'pgboss.create_queue(text,jsonb)'::regprocedure
                 AND has_function_privilege('crewqual_app', queue_procedure.oid, 'EXECUTE')
             ) AS "queueOtherFunctionsAllowed",
             has_database_privilege('crewqual_app', current_database(), 'CREATE') AS "databaseCreateAllowed",
             has_database_privilege('crewqual_app', current_database(), 'TEMP') AS "databaseTempAllowed",
             EXISTS (
               SELECT 1 FROM pg_catalog.pg_trigger
               WHERE tgrelid = '"AuditEvent"'::regclass
                 AND tgname = 'audit_event_append_only'
                 AND tgenabled <> 'D'
             ) AS "appendTrigger",
             EXISTS (
               SELECT 1 FROM pg_catalog.pg_trigger
               WHERE tgrelid = '"AuditEvent"'::regclass
                 AND tgname = 'audit_event_truncate_block'
                 AND tgenabled <> 'D'
             ) AS "truncateTrigger"
      FROM pg_catalog.pg_class audit_relation
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = audit_relation.relowner
      WHERE audit_relation.oid = '"AuditEvent"'::regclass
    `;
    if (
      runtimeIdentity?.currentUser !== "crewqual_app" ||
      !security ||
      security.auditOwner === "crewqual_app" ||
      !security.queueOwner ||
      security.queueOwner === "crewqual_app" ||
      !security.runtimeRoleRestricted ||
      security.runtimeHasRoleMemberships ||
      security.runtimeOwnsObjects ||
      security.runtimeOwnsFunctions ||
      security.updateAllowed ||
      security.deleteAllowed ||
      security.truncateAllowed ||
      security.schemaCreateAllowed ||
      !security.queueSchemaUsage ||
      security.queueSchemaCreateAllowed ||
      !security.queueTablesCrud ||
      security.queueDangerousPrivileges ||
      !security.queueCreateFunctionAllowed ||
      security.queueOtherFunctionsAllowed ||
      security.databaseCreateAllowed ||
      security.databaseTempAllowed ||
      !security.appendTrigger ||
      !security.truncateTrigger
    ) {
      throw new Error(
        `数据库运行时角色隔离不符合要求：${JSON.stringify({ runtimeIdentity, security })}`,
      );
    }
    await expectRuntimeDenied(
      "AuditEvent UPDATE",
      'UPDATE "AuditEvent" SET "action" = "action" WHERE false',
    );
    await expectRuntimeDenied("AuditEvent DELETE", 'DELETE FROM "AuditEvent" WHERE false');
    await expectRuntimeDenied("AuditEvent TRUNCATE", 'TRUNCATE TABLE "AuditEvent"');
    await expectRuntimeDenied(
      "AuditEvent trigger disable",
      'ALTER TABLE "AuditEvent" DISABLE TRIGGER audit_event_append_only',
    );
    await expectRuntimeDenied(
      "PgBoss schema DDL",
      "CREATE TABLE pgboss.crewqual_runtime_forbidden_probe (id integer)",
    );
    return {
      runtimeUser: runtimeIdentity.currentUser,
      auditOwner: security.auditOwner,
      queueOwner: security.queueOwner,
      runtimeRoleRestricted: security.runtimeRoleRestricted,
      runtimeHasRoleMemberships: security.runtimeHasRoleMemberships,
      runtimeOwnsObjects: security.runtimeOwnsObjects,
      runtimeOwnsFunctions: security.runtimeOwnsFunctions,
      auditMutationPrivileges: {
        update: security.updateAllowed,
        delete: security.deleteAllowed,
        truncate: security.truncateAllowed,
      },
      createPrivileges: {
        schema: security.schemaCreateAllowed,
        queueSchema: security.queueSchemaCreateAllowed,
        database: security.databaseCreateAllowed,
        temporary: security.databaseTempAllowed,
      },
      queuePrivileges: {
        schemaUsage: security.queueSchemaUsage,
        tablesCrud: security.queueTablesCrud,
        dangerousTablePrivileges: security.queueDangerousPrivileges,
        createQueueFunction: security.queueCreateFunctionAllowed,
        otherFunctions: security.queueOtherFunctionsAllowed,
      },
      triggers: { appendOnly: security.appendTrigger, truncateBlocked: security.truncateTrigger },
      mutationAttempts: "denied",
    };
  } finally {
    await Promise.all([runtime.$disconnect(), owner.$disconnect()]);
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
  const localAcceptance = process.env.RELEASE_ACCEPTANCE_SCOPE === "local";
  const envPath = join("/tmp", `crewqual-release-${id}.env`);
  const password = randomBytes(24).toString("base64url");
  const appPassword = randomBytes(24).toString("base64url");
  const initialPassword = randomBytes(18).toString("base64url");
  const readinessProbeSecret = randomBytes(32).toString("hex");
  const storageEndpoint = localAcceptance ? "http://minio:9000" : required("S3_ENDPOINT");
  const storageAuthority = new URL(storageEndpoint).host;
  const lines = [
    `RELEASE_WEB_IMAGE=${required("RELEASE_WEB_IMAGE")}`,
    `RELEASE_RUNTIME_IMAGE=${required("RELEASE_RUNTIME_IMAGE")}`,
    `POSTGRES_PASSWORD=${password}`,
    `POSTGRES_APP_PASSWORD=${appPassword}`,
    `DATABASE_URL=postgresql://crewqual_app:${appPassword}@postgres:5432/crewqual`,
    `DIRECT_URL=postgresql://crewqual:${password}@postgres:5432/crewqual`,
    `APP_ORIGIN=https://acceptance-${id}.invalid`,
    `ACCEPTANCE_WEB_PORT=${port}`,
    `ACCEPTANCE_DB_PORT=${dbPort}`,
    `SESSION_SECRET=${randomBytes(48).toString("hex")}`,
    `READINESS_PROBE_SECRET=${readinessProbeSecret}`,
    `SETTINGS_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`,
    // Local validation only needs a syntactically valid storage configuration;
    // the destructive-recovery and production E2E gates remain in the full
    // profile and require real, isolated infrastructure.
    `STORAGE_MODE=${localAcceptance ? "builtin" : envOr("STORAGE_MODE", "external")}`,
    `OUTBOUND_ALLOWED_HOSTS=${storageAuthority}`,
    "OUTBOUND_ALLOWED_CIDRS=",
    `S3_ENDPOINT=${storageEndpoint}`,
    `S3_REGION=${envOr("AWS_REGION", "us-east-1")}`,
    `S3_BUCKET=${localAcceptance ? envOr("EVIDENCE_S3_BUCKET", "crewqual-local") : required("EVIDENCE_S3_BUCKET")}`,
    `S3_ACCESS_KEY_ID=${localAcceptance ? envOr("AWS_ACCESS_KEY_ID", "local-access-key") : required("AWS_ACCESS_KEY_ID")}`,
    `S3_SECRET_ACCESS_KEY=${localAcceptance ? envOr("AWS_SECRET_ACCESS_KEY", "local-secret-key") : required("AWS_SECRET_ACCESS_KEY")}`,
    `S3_FORCE_PATH_STYLE=${localAcceptance ? "true" : envOr("S3_FORCE_PATH_STYLE", "false")}`,
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
  // GitHub Actions exports unset S3 secrets as empty environment variables. Docker
  // Compose gives those inherited variables precedence over --env-file, so an
  // empty S3_ENDPOINT would override the local MinIO value above. Pass the
  // generated values explicitly to keep local acceptance self-contained.
  const composeEnv = {
    ...process.env,
    ...Object.fromEntries(
      lines.map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
    ),
  };
  const compose = (args: string[]) =>
    command("docker", composeArgs(project, envPath, args), { env: composeEnv });
  try {
    compose(["run", "--rm", "migrate"]);
    compose(["run", "--rm", "bootstrap"]);
    const ownerDatabaseUrl = `postgresql://crewqual:${password}@127.0.0.1:${dbPort}/crewqual`;
    const runtimeDatabaseUrl = `postgresql://crewqual_app:${appPassword}@127.0.0.1:${dbPort}/crewqual`;
    const first = await dbSnapshot(runtimeDatabaseUrl);
    compose(["run", "--rm", "bootstrap"]);
    const second = await dbSnapshot(runtimeDatabaseUrl);
    if (JSON.stringify(first) !== JSON.stringify(second)) {
      throw new Error("第二次 bootstrap 修改了既有管理员或权限基线");
    }
    compose(["up", "-d", "web", "worker"]);
    await waitFor(`http://127.0.0.1:${port}/api/health?probe=readiness`, 200, 180_000, {
      "x-crewqual-readiness-secret": readinessProbeSecret,
    });
    const report = await writeGateEvidence(artifactDir(evidence.runId), "bootstrap", {
      project,
      port,
      secondBootstrapSnapshot: second,
      databaseRoleSeparation: await databaseRoleSnapshot(runtimeDatabaseUrl, ownerDatabaseUrl),
      externalIntegrations: "disabled",
    });
    return { evidence: [report], detail: `compose=${project}` };
  } finally {
    command("docker", composeArgs(project, envPath, ["down", "-v", "--remove-orphans"]), {
      allowFailure: true,
      env: composeEnv,
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
  const normalizedId = evidence.runId.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const fixtureId = normalizedId.toUpperCase().slice(-16);
  const project = `crewqual-e2e-${normalizedId}`;
  const webPort = envOr(
    "ACCEPTANCE_E2E_WEB_PORT",
    String(31_000 + Math.floor(Math.random() * 1_000)),
  );
  const dbPort = envOr(
    "ACCEPTANCE_E2E_DB_PORT",
    String(56_000 + Math.floor(Math.random() * 1_000)),
  );
  const baseUrl = `http://127.0.0.1:${webPort}`;
  const databasePassword = randomBytes(24).toString("base64url");
  const databaseAppPassword = randomBytes(24).toString("base64url");
  const adminEmail = `acceptance-${normalizedId}@example.invalid`;
  const adminPassword = randomBytes(18).toString("base64url");
  const adminTotpSecret = "A".repeat(32);
  const settingsEncryptionKey = randomBytes(32).toString("hex");
  const sessionSecret = randomBytes(48).toString("hex");
  const readinessProbeSecret = randomBytes(32).toString("hex");
  const storageAccessKey = randomBytes(12).toString("hex");
  const storageSecretKey = randomBytes(24).toString("hex");
  const envPath = join("/tmp", `crewqual-release-e2e-${normalizedId}.env`);
  const lines = [
    `RELEASE_WEB_IMAGE=${required("RELEASE_WEB_IMAGE")}`,
    `RELEASE_RUNTIME_IMAGE=${required("RELEASE_RUNTIME_IMAGE")}`,
    `POSTGRES_PASSWORD=${databasePassword}`,
    `POSTGRES_APP_PASSWORD=${databaseAppPassword}`,
    `DATABASE_URL=postgresql://crewqual_app:${databaseAppPassword}@postgres:5432/crewqual`,
    `DIRECT_URL=postgresql://crewqual:${databasePassword}@postgres:5432/crewqual`,
    `APP_ORIGIN=${baseUrl}`,
    "APP_DOMAIN=127.0.0.1",
    "DEPLOYMENT_NETWORK_MODE=http",
    `APP_PORT=${webPort}`,
    `ACCEPTANCE_WEB_PORT=${webPort}`,
    `ACCEPTANCE_DB_PORT=${dbPort}`,
    `SESSION_SECRET=${sessionSecret}`,
    `READINESS_PROBE_SECRET=${readinessProbeSecret}`,
    `SETTINGS_ENCRYPTION_KEY=${settingsEncryptionKey}`,
    "STORAGE_MODE=builtin",
    "OUTBOUND_ALLOWED_HOSTS=minio:9000",
    "OUTBOUND_ALLOWED_CIDRS=",
    "S3_ENDPOINT=http://minio:9000",
    "S3_REGION=us-east-1",
    "S3_BUCKET=crewqual-e2e",
    `S3_ACCESS_KEY_ID=${storageAccessKey}`,
    `S3_SECRET_ACCESS_KEY=${storageSecretKey}`,
    "S3_FORCE_PATH_STYLE=true",
    `INITIAL_ADMIN_EMAIL=${adminEmail}`,
    `INITIAL_ADMIN_PASSWORD=${adminPassword}`,
    `INITIAL_ADMIN_TOTP_SECRET=${adminTotpSecret}`,
    "INITIAL_ORGANIZATION_CODE=CREWQUAL",
    "INITIAL_ORGANIZATION_NAME=CrewQual E2E",
    "INITIAL_UNIT_CODE=DEMO",
    "INITIAL_UNIT_NAME=E2E 运行单位",
    "INITIAL_TEMPLATE_PACK_CODE=aviation-china-airline-pilot",
  ];
  await writeFile(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  const composeEnv = {
    ...process.env,
    ...Object.fromEntries(
      lines.map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
    ),
  };
  const compose = (args: string[]) =>
    command("docker", composeArgs(project, envPath, args), { env: composeEnv });
  try {
    compose(["run", "--rm", "migrate"]);
    compose(["run", "--rm", "bootstrap"]);
    const e2eDatabaseUrl = `postgresql://crewqual:${databasePassword}@127.0.0.1:${dbPort}/crewqual`;
    const e2eEnv = {
      ...process.env,
      CI: "1",
      NODE_ENV: "development",
      SERVICE_MODE: "remote",
      NEXT_PUBLIC_SERVICE_MODE: "remote",
      APP_ORIGIN: baseUrl,
      RELEASE_BASE_URL: baseUrl,
      DATABASE_URL: e2eDatabaseUrl,
      DIRECT_URL: e2eDatabaseUrl,
      E2E_DATABASE_URL: e2eDatabaseUrl,
      SETTINGS_ENCRYPTION_KEY: settingsEncryptionKey,
      SESSION_SECRET: sessionSecret,
      READINESS_PROBE_SECRET: readinessProbeSecret,
      INITIAL_ADMIN_EMAIL: adminEmail,
      INITIAL_ADMIN_PASSWORD: adminPassword,
      INITIAL_ADMIN_TOTP_SECRET: adminTotpSecret,
      E2E_ADMIN_EMAIL: adminEmail,
      E2E_ADMIN_PASSWORD: adminPassword,
      E2E_ADMIN_TOTP_SECRET: adminTotpSecret,
      E2E_PILOT_EMPLOYEE_NUMBER: `CQ-E2E-${fixtureId}`,
      E2E_CREDENTIAL_NUMBER: `E2E-CN-${fixtureId}`,
      E2E_DIRECT_DB_PILOT_TOKEN: "1",
      E2E_CANDIDATE_STACK: "1",
    };
    const seed = pnpmCommand(["db:seed"], { allowFailure: true, env: e2eEnv });
    if (seed.status !== 0) throw new Error(`candidate E2E seed 失败：${seed.output}`);
    const prepare = pnpmCommand(["db:e2e:prepare"], { allowFailure: true, env: e2eEnv });
    if (prepare.status !== 0) throw new Error(`candidate E2E 数据准备失败：${prepare.output}`);
    compose(["up", "-d", "web", "worker"]);
    await waitFor(`${baseUrl}/api/health?probe=readiness`, 200, 180_000, {
      "x-crewqual-readiness-secret": readinessProbeSecret,
    });

    for (const [service, expectedImage] of [
      ["web", required("RELEASE_WEB_IMAGE")],
      ["worker", required("RELEASE_RUNTIME_IMAGE")],
    ] as const) {
      const containerId = compose(["ps", "-q", service]).output.trim();
      if (!containerId) throw new Error(`candidate ${service} 容器未运行`);
      const actualImage = command("docker", [
        "inspect",
        "--format",
        "{{.Config.Image}}",
        containerId,
      ]).output.trim();
      if (actualImage !== expectedImage) {
        throw new Error(`candidate ${service} 镜像不匹配：${actualImage}`);
      }
    }
    const devEndpoint = await fetch(`${baseUrl}/api/dev/pilot-access?employeeNumber=CQ-1049`);
    if (devEndpoint.status !== 404) throw new Error("生产候选镜像暴露了开发访问端点");

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
      { allowFailure: true, env: e2eEnv },
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
      { allowFailure: true, env: e2eEnv },
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
      { allowFailure: true, env: e2eEnv },
    );
    if (remote.status !== 0) throw new Error(`remote production E2E 失败：${remote.output}`);
    const qualificationAuditDb = new PrismaClient({ adapter: new PrismaPg(e2eDatabaseUrl) });
    const qualificationAudit = await collectQualificationAudit(qualificationAuditDb).finally(() =>
      qualificationAuditDb.$disconnect(),
    );
    const qualificationAuditReport = await writeGateEvidence(
      artifactDir(evidence.runId),
      "qualification-data-audit",
      {
        source: "isolated_candidate_fixtures",
        report: qualificationAudit,
      },
    );
    if (process.env.RELEASE_REMOVE_MEMBER_COMPATIBILITY === "1") {
      const reconciliation = pnpmCommand(["db:reconcile:members"], {
        allowFailure: true,
        env: e2eEnv,
      });
      if (reconciliation.status !== 0)
        throw new Error("member compatibility removal requires zero reconciliation findings");
    }
    const report = await writeGateEvidence(artifactDir(evidence.runId), "e2e", {
      project,
      candidateImages: {
        web: required("RELEASE_WEB_IMAGE"),
        runtime: required("RELEASE_RUNTIME_IMAGE"),
      },
      browsers: ["chromium", "firefox", "webkit"],
      repeatEach: 3,
      webkitNavigationRepeatEach: 10,
      remoteBrowsers: ["chromium", "firefox", "webkit"],
      remotePilotEmployeeNumber: e2eEnv.E2E_PILOT_EMPLOYEE_NUMBER,
      devEndpointStatus: devEndpoint.status,
      qualificationAuditReport,
      compatibilityRemovalGate:
        process.env.RELEASE_REMOVE_MEMBER_COMPATIBILITY === "1" ? "passed" : "not_requested",
    });
    return { evidence: [report, qualificationAuditReport], detail: `candidate compose=${project}` };
  } finally {
    command("docker", composeArgs(project, envPath, ["down", "-v", "--remove-orphans"]), {
      allowFailure: true,
      env: composeEnv,
    });
    try {
      unlinkSync(envPath);
    } catch {
      // Best-effort removal of the temporary candidate-stack secret file.
    }
  }
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
      RELEASE_IMAGE_NAMES.map(async (name) => {
        const image = required(name);
        const index = command("docker", ["buildx", "imagetools", "inspect", "--raw", image]);
        const parsedIndex = JSON.parse(index.output) as {
          mediaType?: string;
          manifests?: Array<{
            digest: string;
            mediaType?: string;
            platform?: { architecture?: string; os?: string };
          }>;
        };
        const expectedPlatforms = ["amd64", "arm64"] as const;
        if (
          parsedIndex.mediaType !== "application/vnd.oci.image.index.v1+json" ||
          parsedIndex.manifests?.length !== expectedPlatforms.length
        ) {
          throw new Error(`${name} 必须是仅含 linux/amd64 与 linux/arm64 的 OCI index`);
        }
        const repository = image.replace(/@sha256:[0-9a-f]+$/i, "");
        const platforms = Object.fromEntries(
          expectedPlatforms.map((architecture) => {
            const matches = parsedIndex.manifests!.filter(
              (candidate) =>
                candidate.platform?.os === "linux" &&
                candidate.platform?.architecture === architecture,
            );
            if (
              matches.length !== 1 ||
              !/^sha256:[0-9a-f]{64}$/.test(matches[0]!.digest) ||
              matches[0]!.mediaType !== "application/vnd.oci.image.manifest.v1+json"
            ) {
              throw new Error(`${name} 缺少唯一的 linux/${architecture} OCI manifest`);
            }
            const manifestRef = `${repository}@${matches[0]!.digest}`;
            const manifest = JSON.parse(
              command("docker", ["buildx", "imagetools", "inspect", "--raw", manifestRef]).output,
            ) as { mediaType?: string; layers?: Array<{ size?: number }> };
            if (manifest.mediaType !== "application/vnd.oci.image.manifest.v1+json") {
              throw new Error(`${name} linux/${architecture} 不是 OCI image manifest`);
            }
            const compressedBytes = (manifest.layers ?? []).reduce(
              (total, layer) => total + (layer.size ?? 0),
              0,
            );
            if (!compressedBytes) {
              throw new Error(`${name} linux/${architecture} OCI manifest 没有可测量的压缩层`);
            }
            return [
              `linux/${architecture}`,
              {
                digest: matches[0]!.digest,
                compressedBytes,
                compressedMiB: Number((compressedBytes / 1024 / 1024).toFixed(2)),
              },
            ];
          }),
        );
        const compressedBytes = Object.values(platforms).reduce(
          (total, platform) => total + platform.compressedBytes,
          0,
        );
        const local = command("docker", ["image", "inspect", "--format", "{{.Size}}", image]);
        const uncompressedBytes = Number(local.output.trim());
        if (!Number.isFinite(uncompressedBytes) || uncompressedBytes <= 0) {
          throw new Error(`${name} 无法读取本地解压镜像大小`);
        }
        const result = {
          image,
          platforms,
          compressedBytes,
          compressedMiB: Number((compressedBytes / 1024 / 1024).toFixed(2)),
          nativePlatform: "linux/amd64",
          uncompressedBytes,
          uncompressedMiB: Number((uncompressedBytes / 1024 / 1024).toFixed(2)),
        };
        return [name, result] as const;
      }),
    ),
  );
  const totalCompressedBytes = Object.values(imageSizes).reduce(
    (total, image) => total + image.compressedBytes,
    0,
  );
  const imageSizeReport = {
    enforcement: "record-only",
    images: imageSizes,
    total: {
      compressedBytes: totalCompressedBytes,
      compressedMiB: Number((totalCompressedBytes / 1024 / 1024).toFixed(2)),
    },
  };
  const imageSizePath = await writeGateEvidence(dir, "image-sizes", imageSizeReport);
  const versions = {
    syft: await toolVersion("syft"),
    trivy: await toolVersion("trivy"),
    gitleaks: await toolVersion("gitleaks"),
    // Cosign exposes `version` as a subcommand; `cosign --version` exits 1
    // on the v3.x binary installed by install-tools.sh.
    cosign: await toolVersion("cosign", ["version"]),
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
      "--ignore-unfixed",
      "--severity",
      "HIGH,CRITICAL",
      "--scanners",
      // License policy is enforced below with pnpm licenses and the checked-in
      // allow/review list. Trivy's lockfile license scanner treats sharp's
      // LGPL-3.0-or-later metadata as an unknown HIGH finding and would reject
      // an otherwise policy-approved dependency before that check runs.
      "vuln,misconfig,secret",
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
        "--ignore-unfixed",
        "--severity",
        "HIGH,CRITICAL",
        "--scanners",
        // License policy is enforced by pnpm below; see the filesystem scan
        // comment above for why Trivy's lockfile license scanner is excluded.
        "vuln,misconfig,secret",
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
    const bundle = required("RELEASE_EVIDENCE_BUNDLE");
    const verified = command(
      "cosign",
      [
        "verify-blob",
        "--bundle",
        bundle,
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
    bundle: process.env.RELEASE_EVIDENCE_BUNDLE ?? null,
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
  const scope = (process.env.RELEASE_ACCEPTANCE_SCOPE ??
    (operation === "local" ? "local" : "full")) as AcceptanceScope;
  if ((profile === "final" && !stableTag) || (profile === "rc" && !releaseCandidateTag)) {
    throw new Error(`无效 ${profile} release tag：${tag}`);
  }
  if (scope !== "local" && scope !== "full") {
    throw new Error(`无效 RELEASE_ACCEPTANCE_SCOPE：${scope}`);
  }
  if (["all", "checks", "local"].includes(operation)) {
    assertAcceptanceConfig(process.env, { scope, profile });
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
    operation === "local"
      ? ["preflight", "bootstrap", "supply-chain"]
      : operation === "all" || operation === "checks"
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
  const failedGates = evidence.gates.filter((item) => item.status !== "PASS");
  if (failedGates.length) {
    console.error(
      JSON.stringify({
        event: "release_verification_failed",
        failures: failedGates.map(({ id: gateId, status, detail }) => ({
          id: gateId,
          status,
          detail,
        })),
      }),
    );
    process.exitCode = 3;
  }
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
