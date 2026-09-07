import { access, mkdtemp, mkdir, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ensureConfinedBackupDirectory, normalizeLocalBackupLocation } from "@/server/backup-path";

describe("local backup path policy", () => {
  it("confines local targets to the mounted /backups volume", () => {
    expect(normalizeLocalBackupLocation("/backups", "crewqual/daily")).toEqual({
      endpoint: "/backups",
      basePath: "crewqual/daily",
    });
  });

  it.each([
    ["/tmp", "crewqual"],
    ["/backups", "../escape"],
    ["/backups", "/absolute"],
    ["/backups", "crewqual/./daily"],
  ])("rejects unsafe local location %s/%s", (endpoint, basePath) => {
    expect(() => normalizeLocalBackupLocation(endpoint, basePath)).toThrow();
  });

  it("rejects an existing symlink that redirects a historical target outside its root", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "crewqual-backup-path-"));
    const root = join(sandbox, "backups");
    const outside = join(sandbox, "outside");
    await Promise.all([mkdir(root), mkdir(outside)]);
    await symlink(outside, join(root, "legacy"));
    try {
      await expect(ensureConfinedBackupDirectory(root, "legacy/daily")).rejects.toThrow("符号链接");
      await expect(access(join(outside, "daily"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("removes group and other access from the Worker-private backup root", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "crewqual-backup-mode-"));
    const root = join(sandbox, "backups");
    await mkdir(root, { mode: 0o777 });
    try {
      await ensureConfinedBackupDirectory(root, "daily");
      expect((await stat(root)).mode & 0o777).toBe(0o700);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
