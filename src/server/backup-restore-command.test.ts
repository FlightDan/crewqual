// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const exec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: exec,
}));
import { restorePostgresArchive } from "@/server/backup-runner";

describe("PostgreSQL archive restore command", () => {
  beforeEach(() => {
    exec.mockReset();
    exec.mockImplementation((_command, _args, _options, callback) => callback(null, "", ""));
  });

  it("selects the isolated target explicitly and keeps credentials out of arguments", async () => {
    await restorePostgresArchive(
      "postgresql://restorer:secret@recovery:5433/isolated",
      "/tmp/test.dump",
    );
    expect(exec).toHaveBeenCalledWith(
      "pg_restore",
      [
        "--dbname",
        "dbname='isolated'",
        "--clean",
        "--if-exists",
        "--exit-on-error",
        "--single-transaction",
        "/tmp/test.dump",
      ],
      expect.objectContaining({
        env: expect.objectContaining({ PGHOST: "recovery", PGPORT: "5433", PGPASSWORD: "secret" }),
      }),
      expect.any(Function),
    );
    expect(JSON.stringify(exec.mock.calls[0].slice(0, 2))).not.toContain("secret");
  });

  it("quotes database names instead of allowing conninfo injection", async () => {
    const database = "recovery' host=source\\name";
    await restorePostgresArchive(
      `postgresql://u:p@target/${encodeURIComponent(database)}`,
      "/tmp/test.dump",
    );
    expect(exec.mock.calls[0][1][1]).toBe("dbname='recovery\\' host=source\\\\name'");
  });

  it("propagates command failure so callers cannot mark restore successful", async () => {
    exec.mockImplementation((_command, _args, _options, callback) =>
      callback(new Error("invalid archive")),
    );
    await expect(
      restorePostgresArchive("postgresql://u:p@target/recovery", "/tmp/bad.dump"),
    ).rejects.toThrow("invalid archive");
  });
});
