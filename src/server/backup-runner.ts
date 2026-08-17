import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { getServerConfig } from "@/server/config";
import { decryptSettingSecret } from "@/server/crypto";
import { getPrisma } from "@/server/prisma";
import { putPrivateObjectAtKey, readPrivateEvidence } from "@/server/storage";
/* eslint-disable @typescript-eslint/no-explicit-any */

const execFileAsync = promisify(execFile);

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

async function runRclone(target: any, args: string[]) {
  const secret = target.secretCiphertext ? decryptSettingSecret(target.secretCiphertext) : "";
  let values: Record<string, string> = {};
  try {
    values = secret ? (JSON.parse(secret) as Record<string, string>) : {};
  } catch {
    throw new Error("备份目标密钥必须是 JSON");
  }
  const configDir = await mkdtemp(join(tmpdir(), "crewqual-rclone-"));
  const configPath = join(configDir, "rclone.conf");
  const obscured = async (value: string) =>
    value ? String((await execFileAsync("rclone", ["obscure", value])).stdout).trim() : "";
  const lines = [
    `[crewqual]`,
    `type = ${target.type === "S3" ? "s3" : target.type === "SMB" ? "smb" : target.type === "FTP" ? "ftp" : "webdav"}`,
  ];
  if (target.type === "S3")
    lines.push(
      "provider = Other",
      `endpoint = ${target.endpoint}`,
      `access_key_id = ${values.accessKeyId ?? values.username ?? ""}`,
      `secret_access_key = ${await obscured(values.secretAccessKey ?? values.password ?? "")}`,
    );
  if (target.type === "SMB")
    lines.push(
      `host = ${target.endpoint}`,
      `user = ${values.username ?? ""}`,
      `pass = ${await obscured(values.password ?? "")}`,
    );
  if (target.type === "FTP")
    lines.push(
      `host = ${target.endpoint}`,
      `user = ${values.username ?? ""}`,
      `pass = ${await obscured(values.password ?? "")}`,
      `tls = ${values.tls === "false" ? "false" : "true"}`,
    );
  if (target.type === "WEBDAV")
    lines.push(
      `url = ${target.endpoint}`,
      "vendor = other",
      `user = ${values.username ?? ""}`,
      `pass = ${await obscured(values.password ?? "")}`,
    );
  await writeFile(configPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  try {
    return await execFileAsync("rclone", ["--config", configPath, ...args], {
      timeout: 60 * 60 * 1000,
    });
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
}

function rcloneDestination(target: any, name: string) {
  return `crewqual:${target.basePath.replace(/^\/+|\/+$/g, "")}/${name}`;
}

async function copyArtifact(source: string, target: any, destinationName: string) {
  const destination =
    target.type === "LOCAL"
      ? `${target.endpoint.replace(/\/$/, "")}/${target.basePath.replace(/^\/+|\/+$/g, "")}/${destinationName}`
      : rcloneDestination(target, destinationName);
  if (target.type === "LOCAL") {
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
    return destination;
  }
  await runRclone(target, ["copyto", source, destination]);
  return destination;
}

async function fetchArtifact(path: string, target: any, destination: string) {
  if (target.type === "LOCAL") {
    await cp(path, destination);
    return;
  }
  await runRclone(target, [
    "copyto",
    rcloneDestination(target, path.split("/").pop() ?? ""),
    destination,
  ]);
}

export async function executeBackupRun(runId: string) {
  const db = getPrisma();
  const run = await db.backupRun.findUnique({
    where: { id: runId },
    include: { plan: { include: { target: true } } },
  });
  if (!run || run.status !== "QUEUED") return { status: "ignored" as const };
  await db.backupRun.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  const workdir = await mkdtemp(join(tmpdir(), "crewqual-backup-"));
  try {
    const targetSecret = run.plan.target.secretCiphertext
      ? decryptSettingSecret(run.plan.target.secretCiphertext)
      : "";
    if (run.plan.target.encryptionEnabled && !targetSecret)
      throw new Error("备份目标未配置加密密钥");
    const nowLabel = new Date().toISOString().replace(/[:.]/g, "-");
    const artifactName = `${run.plan.source.toLowerCase()}-${run.id}-${nowLabel}.${run.plan.target.encryptionEnabled ? "enc" : "dump"}`;
    const artifactPath = join(workdir, artifactName);
    if (run.plan.source === "DATABASE") {
      const rawPath = join(workdir, "database.dump");
      const config = getServerConfig();
      await execFileAsync("pg_dump", ["--format=custom", "--file", rawPath, config.DATABASE_URL], {
        timeout: 60 * 60 * 1000,
      });
      const raw = await readFile(rawPath);
      await writeFile(
        artifactPath,
        run.plan.target.encryptionEnabled ? encryptArtifact(raw, targetSecret) : raw,
      );
    } else {
      const images = await db.evidenceImage.findMany({
        where: { status: { not: "orphaned" } },
        select: { objectKey: true, sha256: true, mimeType: true, updatedAt: true },
      });
      const manifest = images.map((image) => ({
        objectKey: image.objectKey,
        sha256: image.sha256,
        mimeType: image.mimeType,
      }));
      const changed =
        run.mode === "INCREMENTAL" && run.plan.lastSuccessfulAt
          ? images
              .filter((image) => image.updatedAt > run.plan.lastSuccessfulAt!)
              .map((image) => ({
                objectKey: image.objectKey,
                sha256: image.sha256,
                mimeType: image.mimeType,
              }))
          : manifest;
      const raw = Buffer.from(
        JSON.stringify({
          version: 1,
          mode: run.mode,
          createdAt: new Date().toISOString(),
          images: manifest,
          objects: changed,
        }),
      );
      await writeFile(
        artifactPath,
        run.plan.target.encryptionEnabled ? encryptArtifact(raw, targetSecret) : raw,
      );
      await writeFile(join(workdir, "manifest.json"), raw);
      for (const image of changed) {
        const objectPath = join(workdir, "objects", image.objectKey);
        await mkdir(dirname(objectPath), { recursive: true });
        await writeFile(objectPath, await readPrivateEvidence(image.objectKey));
      }
      const rawArchive = join(workdir, "gallery.tar");
      await execFileAsync("tar", ["-cf", rawArchive, "manifest.json", "objects"], {
        cwd: workdir,
        timeout: 60 * 60 * 1000,
      });
      const archive = await readFile(rawArchive);
      await writeFile(
        artifactPath,
        run.plan.target.encryptionEnabled ? encryptArtifact(archive, targetSecret) : archive,
      );
    }
    const destination = await copyArtifact(artifactPath, run.plan.target, artifactName);
    const bytes = (await readFile(artifactPath)).byteLength;
    await db.backupRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        completedAt: new Date(),
        artifactPath: destination,
        bytesWritten: bytes,
        manifestSha256: createHash("sha256")
          .update(await readFile(artifactPath))
          .digest("hex"),
      },
    });
    await db.backupPlan.update({
      where: { id: run.planId },
      data: { lastSuccessfulAt: new Date() },
    });
    return { status: "succeeded" as const, bytes };
  } catch (error) {
    await db.backupRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    return {
      status: "failed" as const,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function processQueuedBackupRuns() {
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
    await db.backupRun.create({ data: { planId: plan.id, mode: plan.mode } });
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

export async function restoreBackupRun(runId: string, confirmation: string) {
  if (confirmation !== "恢复") throw new Error("必须输入“恢复”确认破坏性操作");
  const db = getPrisma();
  const run = await db.backupRun.findUnique({
    where: { id: runId },
    include: { plan: { include: { target: true } } },
  });
  if (!run || run.status !== "SUCCEEDED" || !run.artifactPath)
    throw new Error("备份运行记录不存在或未成功");
  const workdir = await mkdtemp(join(tmpdir(), "crewqual-restore-"));
  try {
    const secret = run.plan.target.secretCiphertext
      ? decryptSettingSecret(run.plan.target.secretCiphertext)
      : "";
    if (run.plan.source === "DATABASE") {
      const downloaded = join(workdir, "artifact.bin");
      await fetchArtifact(run.artifactPath, run.plan.target, downloaded);
      const restored = decryptArtifact(await readFile(downloaded), secret);
      const safety = join(workdir, "before-restore.dump");
      await execFileAsync(
        "pg_dump",
        ["--format=custom", "--file", safety, getServerConfig().DATABASE_URL],
        { timeout: 60 * 60 * 1000 },
      );
      const restoreFile = join(workdir, "restore.dump");
      await writeFile(restoreFile, restored);
      try {
        await execFileAsync(
          "pg_restore",
          ["--clean", "--if-exists", "--dbname", getServerConfig().DATABASE_URL, restoreFile],
          { timeout: 60 * 60 * 1000 },
        );
      } catch (error) {
        await execFileAsync(
          "pg_restore",
          ["--clean", "--if-exists", "--dbname", getServerConfig().DATABASE_URL, safety],
          { timeout: 60 * 60 * 1000 },
        ).catch(() => undefined);
        throw error;
      }
      return { source: "DATABASE", status: "restored" as const };
    }
    const runs =
      run.mode === "INCREMENTAL"
        ? (
            await db.backupRun.findMany({
              where: { planId: run.planId, status: "SUCCEEDED", createdAt: { lte: run.createdAt } },
              orderBy: { createdAt: "asc" },
            })
          ).filter((item) => item.mode === "FULL" || item.createdAt <= run.createdAt)
        : [run];
    const baselineIndex = runs.map((item) => item.mode).lastIndexOf("FULL");
    const restoreRuns = (baselineIndex >= 0 ? runs.slice(baselineIndex) : runs).filter(
      (item) => item.artifactPath,
    );
    let restoredObjects = 0;
    for (let index = 0; index < restoreRuns.length; index += 1) {
      const galleryRun = restoreRuns[index]!;
      const downloaded = join(workdir, `gallery-${index}.bin`);
      await fetchArtifact(galleryRun.artifactPath!, run.plan.target, downloaded);
      const archive = join(workdir, `gallery-${index}.tar`);
      await writeFile(archive, decryptArtifact(await readFile(downloaded), secret));
      const extractDir = join(workdir, `extract-${index}`);
      await mkdir(extractDir, { recursive: true });
      await execFileAsync("tar", ["-xf", archive, "-C", extractDir], { timeout: 60 * 60 * 1000 });
      const manifest = JSON.parse(await readFile(join(extractDir, "manifest.json"), "utf8")) as {
        images: Array<{ objectKey: string; mimeType: string; sha256: string }>;
        objects?: Array<{ objectKey: string; mimeType: string; sha256: string }>;
      };
      for (const image of manifest.objects ?? manifest.images) {
        const bytes = await readFile(join(extractDir, "objects", image.objectKey));
        await putPrivateObjectAtKey(
          image.objectKey,
          bytes,
          image.mimeType === "image/avif" ? "image/avif" : "image/jpeg",
          image.sha256,
        );
        restoredObjects += 1;
      }
    }
    return { source: "GALLERY", restoredObjects, status: "restored" as const };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function testBackupTarget(targetId: string) {
  const db = getPrisma();
  const target = await db.backupTarget.findUnique({ where: { id: targetId } });
  if (!target) throw new Error("备份目标不存在");
  const testedAt = new Date();
  try {
    const destination = `${target.endpoint.replace(/\/$/, "")}/${target.basePath.replace(/^\/+|\/+$/g, "")}`;
    if (target.type === "LOCAL") await mkdir(destination, { recursive: true });
    else await runRclone(target, ["lsd", rcloneDestination(target, "")]);
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
