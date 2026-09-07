import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import { posix } from "node:path";
import { ApiError } from "@/server/api-error";

/**
 * Local backup targets are intentionally confined to the Worker /backups
 * volume.  The endpoint is not a user-controlled host path; only the
 * relative subdirectory may be selected.
 */
export function normalizeLocalBackupLocation(endpoint: string, basePath: string) {
  const trimmedEndpoint = endpoint.trim();
  const trimmedBasePath = basePath.trim().replaceAll("\\", "/");
  if (trimmedEndpoint !== "/backups") {
    throw new ApiError(
      "INVALID_LOCAL_BACKUP_PATH",
      "本地备份目标必须使用 Worker 的 /backups 卷",
      422,
    );
  }
  if (
    !trimmedBasePath ||
    trimmedBasePath.startsWith("/") ||
    trimmedBasePath.endsWith("/") ||
    trimmedBasePath.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new ApiError(
      "INVALID_LOCAL_BACKUP_PATH",
      "本地备份子目录必须是 /backups 下的相对路径",
      422,
    );
  }
  const resolved = posix.resolve("/backups", trimmedBasePath);
  if (resolved !== `/backups/${trimmedBasePath}` || !resolved.startsWith("/backups/")) {
    throw new ApiError("INVALID_LOCAL_BACKUP_PATH", "本地备份路径无效", 422);
  }
  return { endpoint: "/backups", basePath: trimmedBasePath };
}

/**
 * Create and resolve a directory without allowing an existing symlink to
 * redirect writes outside the configured root. Each component is checked
 * before the next one is created, and callers immediately use the canonical
 * directory returned here.
 */
export async function ensureConfinedBackupDirectory(root: string, relativePath: string) {
  const normalizedRoot = posix.resolve(root);
  const candidate = posix.resolve(normalizedRoot, relativePath);
  if (candidate === normalizedRoot || !candidate.startsWith(`${normalizedRoot}/`)) {
    throw new Error("本地备份目录超出允许范围");
  }
  const resolvedRoot = await realpath(normalizedRoot);
  if (resolvedRoot !== normalizedRoot) {
    throw new Error("本地备份根目录不能是符号链接");
  }
  const rootMetadata = await lstat(normalizedRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("本地备份根目录必须是常规目录");
  }
  // The named volume is mounted only into Worker. Remove group/other access
  // before relying on path checks so no different container UID can race a
  // checked component between lstat/realpath and the subsequent file open.
  await chmod(normalizedRoot, 0o700);
  if ((await lstat(normalizedRoot)).mode & 0o077) {
    throw new Error("本地备份根目录权限不安全");
  }
  let current = normalizedRoot;
  for (const segment of relativePath.split("/")) {
    current = posix.join(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const metadata = await lstat(current);
    const resolved = await realpath(current);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      resolved !== current ||
      !resolved.startsWith(`${resolvedRoot}/`)
    ) {
      throw new Error("本地备份目录包含符号链接或超出 /backups 卷");
    }
  }
  return current;
}

export async function prepareLocalBackupDirectory(endpoint: string, basePath: string) {
  const normalized = normalizeLocalBackupLocation(endpoint, basePath);
  return ensureConfinedBackupDirectory(normalized.endpoint, normalized.basePath);
}
