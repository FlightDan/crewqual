import { posix } from "node:path";
import { ApiError } from "@/server/api";

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
