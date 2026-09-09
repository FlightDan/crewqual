/** Runs only inside the disposable release Compose stack, using production backup/restore code. */
import assert from "node:assert/strict";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import {
  S3Client,
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { executeBackupRun, restoreBackupRun } from "../../src/server/backup-runner";
import { encryptSettingSecret } from "../../src/server/crypto";
import { getPrisma, disconnectPrisma } from "../../src/server/prisma";
import { putPrivateObjectAtKey } from "../../src/server/storage";
import { EVIDENCE_STORAGE_ENCODING_VERSION } from "../../src/server/evidence-provenance";

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const required = (key: string) => {
  const value = process.env[key];
  assert(value, `${key} missing`);
  return value;
};
const connect = (url: string) => new PrismaClient({ adapter: new PrismaPg(url) });
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

// Only hashes and counts leave this process; fixtures and database secrets never enter evidence.
async function snapshot(db: PrismaClient, businessOnly = false) {
  const tables = await db.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  const result: Record<string, { count: number; sha256: string }> = {};
  for (const { tablename } of tables) {
    if (businessOnly && ["BackupTarget", "BackupPlan", "BackupRun"].includes(tablename)) continue;
    const expression =
      businessOnly && tablename === "EvidenceImage"
        ? "to_jsonb(t) - ARRAY['storageEncodingVersion','sanitizedAt','sha256','mimeType','byteSize','width','height','updatedAt']"
        : "to_jsonb(t)";
    const rows = await db.$queryRawUnsafe<Array<{ row: string }>>(
      `SELECT (${expression})::text AS row FROM ${quote(tablename)} t ORDER BY (${expression})::text COLLATE "C"`,
    );
    result[tablename] = { count: rows.length, sha256: hash(JSON.stringify(rows)) };
  }
  return result;
}

async function main() {
  assert.equal(required("CREWQUAL_ISOLATED_ACCEPTANCE"), "1");
  const sourceUrl = new URL(required("DATABASE_URL"));
  const ownerUrl = new URL(required("ISOLATED_OWNER_DATABASE_URL"));
  assert.equal(sourceUrl.hostname, "postgres");
  assert.equal(sourceUrl.pathname, "/crewqual");
  assert.equal(ownerUrl.hostname, "postgres");
  assert.equal(ownerUrl.pathname, "/crewqual");
  assert.equal(required("S3_ENDPOINT"), "http://minio:9000");
  assert.equal(required("S3_BUCKET"), "crewqual-e2e");
  const db = getPrisma();
  const owner = connect(ownerUrl.toString());
  const s3 = new S3Client({
    endpoint: required("S3_ENDPOINT"),
    region: required("S3_REGION"),
    forcePathStyle: true,
    credentials: {
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
  });
  const workdir = await mkdtemp("/tmp/crewqual-isolated-recovery-");
  const restoreClients: PrismaClient[] = [];
  const suffix = randomBytes(6).toString("hex");
  const backupBucket = `cq-backup-${suffix}`;
  const encryptionKey = randomBytes(32).toString("hex");
  const get = async (bucket: string, key: string) => {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    assert(response.Body);
    return Buffer.from(await response.Body.transformToByteArray());
  };
  const objects = async (bucket: string) => {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const response = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
      );
      keys.push(
        ...(response.Contents ?? []).map((item) => {
          assert(item.Key);
          return item.Key;
        }),
      );
      token = response.NextContinuationToken;
      assert(!response.IsTruncated || token, "truncated storage listing missing cursor");
    } while (token);
    const result: Record<string, string> = {};
    for (const key of keys.sort()) result[key] = hash(await get(bucket, key));
    return result;
  };
  const target = async (label: string) => {
    const name = `cq_restore_${suffix}_${label}`;
    await owner.$executeRawUnsafe(`CREATE DATABASE ${quote(name)}`);
    const url = new URL(ownerUrl);
    url.pathname = `/${name}`;
    const client = connect(url.toString());
    restoreClients.push(client);
    const bucket = `cq-restore-${suffix}-${label}`;
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    return { url: url.toString(), db: client, bucket };
  };
  const restore = async (runId: string, into: Awaited<ReturnType<typeof target>>) => {
    process.env.CREWQUAL_OFFLINE_RESTORE = "1";
    process.env.RESTORE_DATABASE_URL = into.url;
    process.env.RESTORE_S3_BUCKET = into.bucket;
    return restoreBackupRun(runId, "恢复");
  };
  try {
    // Seeding can include metadata-only demo images. Keep those explicitly closed;
    // the two real fixture objects below supply the non-empty recovery coverage.
    await db.evidenceImage.updateMany({ data: { status: "orphaned" } });
    const record = await db.qualificationRecord.findFirstOrThrow({ orderBy: { id: "asc" } });
    assert(record.personId, "fixture must include Person -> QualificationRecord relationship");
    for (let index = 0; index < 2; index++) {
      const bytes = await sharp({
        create: {
          width: 24,
          height: 24,
          channels: 3,
          background: { r: 40 + index * 90, g: 70, b: 110 },
        },
      })
        .jpeg()
        .toBuffer();
      const key = `evidence/isolated-${suffix}/${index}.jpg`;
      await putPrivateObjectAtKey(key, bytes, "image/jpeg", hash(bytes));
      const image = await db.evidenceImage.create({
        data: {
          pilotId: record.pilotId,
          personId: record.personId,
          objectKey: key,
          mimeType: "image/jpeg",
          width: 24,
          height: 24,
          byteSize: bytes.length,
          sha256: hash(bytes),
          status: "linked",
          linkedAt: new Date(),
          storageEncodingVersion: EVIDENCE_STORAGE_ENCODING_VERSION,
          sanitizedAt: new Date(),
          expiresAt: new Date("2099-01-01"),
        },
      });
      await db.qualificationEvidence.create({
        data: { evidenceImageId: image.id, qualificationRecordId: record.id },
      });
    }
    await s3.send(new CreateBucketCommand({ Bucket: backupBucket }));
    const backupTarget = await db.backupTarget.create({
      data: {
        name: "Isolated acceptance S3",
        type: "S3",
        endpoint: required("S3_ENDPOINT"),
        basePath: `${backupBucket}/artifacts`,
        encryptionEnabled: true,
        secretCiphertext: encryptSettingSecret(
          JSON.stringify({
            accessKeyId: required("S3_ACCESS_KEY_ID"),
            secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
            encryptionKey,
          }),
        ),
      },
    });
    const backup = async (source: "DATABASE" | "GALLERY") => {
      const plan = await db.backupPlan.create({
        data: {
          name: source,
          source,
          mode: "FULL",
          targetId: backupTarget.id,
          cron: "0 0 1 1 *",
          enabled: false,
        },
      });
      const run = await db.backupRun.create({ data: { planId: plan.id, mode: "FULL" } });
      await executeBackupRun(run.id);
      const completed = await db.backupRun.findUniqueOrThrow({ where: { id: run.id } });
      assert.equal(
        completed.status,
        "SUCCEEDED",
        completed.errorMessage ?? `${source} backup failed`,
      );
      assert(completed.artifactPath && completed.manifestSha256);
      const key = `artifacts/${completed.artifactPath.split("/").at(-1)}`;
      const bytes = await get(backupBucket, key);
      assert.equal(hash(bytes), completed.manifestSha256);
      assert.equal(
        bytes.subarray(0, 6).toString(),
        "CQBK1\0",
        "backup must exercise encrypted artifacts",
      );
      return { run: completed, bytes, key };
    };
    const database = await backup("DATABASE");
    const gallery = await backup("GALLERY");
    const clone = async (
      original: typeof gallery,
      label: string,
      bytes: Buffer,
      trustedHash = original.run.manifestSha256!,
    ) => {
      const name = `${label}.bin`;
      await s3.send(
        new PutObjectCommand({ Bucket: backupBucket, Key: `artifacts/${name}`, Body: bytes }),
      );
      return db.backupRun.create({
        data: {
          planId: original.run.planId,
          scheduledFor: new Date(Date.now() + Math.floor(Math.random() * 1e8)),
          mode: "FULL",
          status: "SUCCEEDED",
          artifactPath: `crewqual:${backupBucket}/artifacts/${name}`,
          manifestSha256: trustedHash,
          bytesWritten: bytes.length,
        },
      });
    };
    const changed = (bytes: Buffer) => {
      const result = Buffer.from(bytes);
      result[result.length - 1] ^= 0xff;
      return result;
    };
    const badDatabase = await clone(database, "tampered-database", changed(database.bytes));
    const badGallery = await clone(gallery, "tampered-gallery", changed(gallery.bytes));
    // Re-sign only the outer fixture checksum to reach the inner object checksum.
    // This exercises the blob integrity boundary instead of failing at the archive boundary again.
    const key = createHash("sha256").update(encryptionKey).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, gallery.bytes.subarray(6, 18));
    decipher.setAuthTag(gallery.bytes.subarray(18, 34));
    const tarPath = join(workdir, "gallery.tar");
    await writeFile(
      tarPath,
      Buffer.concat([decipher.update(gallery.bytes.subarray(34)), decipher.final()]),
    );
    execFileSync("tar", ["-xf", tarPath, "-C", workdir]);
    const manifest = JSON.parse(await readFile(join(workdir, "manifest.json"), "utf8")) as {
      objects: Array<{ objectKey: string }>;
    };
    assert.equal(manifest.objects.length, 2);
    const blobPath = join(workdir, "objects", manifest.objects[1]!.objectKey);
    await writeFile(blobPath, changed(await readFile(blobPath)));
    execFileSync("tar", ["-cf", tarPath, "manifest.json", "objects"], { cwd: workdir });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(await readFile(tarPath)), cipher.final()]);
    const blobArchive = Buffer.concat([
      Buffer.from("CQBK1\0"),
      iv,
      cipher.getAuthTag(),
      ciphertext,
    ]);
    const badBlob = await clone(gallery, "tampered-blob", blobArchive, hash(blobArchive));
    const sourceBefore = await snapshot(db);
    const businessBefore = await snapshot(db, true);
    const sourceObjectsBefore = await objects(required("S3_BUCKET"));
    const backupObjectsBefore = await objects(backupBucket);
    const good = await target("good");
    const databaseResult = await restore(database.run.id, good);
    assert.equal(databaseResult.status, "restored");
    assert.equal(
      await good.db.evidenceImage.count({ where: { storageEncodingVersion: { not: 0 } } }),
      0,
    );
    const galleryResult = await restore(gallery.run.id, good);
    assert.equal(galleryResult.status, "restored");
    assert.deepEqual(
      await snapshot(good.db, true),
      businessBefore,
      "restored business tables / relationships differ",
    );
    const restoredImages = await good.db.evidenceImage.findMany({
      where: { status: { not: "orphaned" } },
      include: { evidence: true },
    });
    assert.equal(restoredImages.length, 2);
    const restoredObjects = await objects(good.bucket);
    assert.deepEqual(
      Object.keys(restoredObjects).sort(),
      restoredImages.map((image) => image.objectKey).sort(),
    );
    for (const image of restoredImages) {
      assert.equal(restoredObjects[image.objectKey], image.sha256);
      assert.equal(image.storageEncodingVersion, EVIDENCE_STORAGE_ENCODING_VERSION);
      assert(
        image.sanitizedAt &&
          image.evidence.some((link) => link.qualificationRecordId === record.id),
      );
      const metadata = await sharp(await get(good.bucket, image.objectKey)).metadata();
      assert.equal(metadata.format, "jpeg");
      assert.equal(metadata.width, image.width);
      assert.equal(metadata.height, image.height);
    }
    const tamper: Record<string, unknown> = {};
    for (const [kind, run] of [
      ["database", badDatabase],
      ["gallery", badGallery],
      ["blob", badBlob],
    ] as const) {
      const into = await target(kind);
      if (kind !== "database") await restore(database.run.id, into);
      const before = await snapshot(into.db);
      let refusal = "";
      try {
        await restore(run.id, into);
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
      }
      assert.match(
        refusal,
        kind === "blob" ? /^备份证据校验失败，拒绝恢复：/ : /^备份制品校验失败/,
      );
      assert.deepEqual(await snapshot(into.db), before, `${kind} refusal changed target database`);
      assert.deepEqual(await objects(into.bucket), {}, `${kind} refusal left stored objects`);
      if (kind !== "database")
        assert.equal(
          await into.db.evidenceImage.count({
            where: { OR: [{ storageEncodingVersion: { not: 0 } }, { sanitizedAt: { not: null } }] },
          }),
          0,
        );
      tamper[kind] = {
        entrypoint: "restoreBackupRun",
        rejected: true,
        reason: refusal,
        targetDatabaseUnchanged: true,
        targetBucketEmpty: true,
        usableEvidenceCount: 0,
      };
    }
    assert.deepEqual(await snapshot(db), sourceBefore, "restore modified source database");
    assert.deepEqual(
      await objects(required("S3_BUCKET")),
      sourceObjectsBefore,
      "restore modified source storage",
    );
    assert.deepEqual(
      await objects(backupBucket),
      backupObjectsBefore,
      "restore modified backup storage",
    );
    console.log(
      JSON.stringify({
        event: "isolated_recovery_complete",
        runner: "production executeBackupRun / restoreBackupRun",
        encryptedArtifacts: true,
        databaseRunId: database.run.id,
        galleryRunId: gallery.run.id,
        databaseArtifactSha256: database.run.manifestSha256,
        galleryArtifactSha256: gallery.run.manifestSha256,
        restoredBusinessTables: businessBefore,
        restoredObjects,
        restoredImageCount: restoredImages.length,
        sourceDatabaseUnchanged: true,
        sourceObjectsUnchanged: true,
        backupObjectsUnchanged: true,
        tamper,
        coverageLimitations: [
          "AWS IAM/KMS and Object Lock enforcement not verified",
          "Cross-region recovery not verified",
          "Production disaster recovery and production RPO/RTO not verified",
        ],
      }),
    );
  } finally {
    await Promise.allSettled([
      disconnectPrisma(),
      owner.$disconnect(),
      ...restoreClients.map((client) => client.$disconnect()),
    ]);
    s3.destroy();
    await rm(workdir, { recursive: true, force: true });
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
