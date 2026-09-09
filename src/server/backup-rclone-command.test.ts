// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { rcloneInvocation } from "@/server/backup-runner";

describe("rclone pinned proxy invocation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("forces the authenticated proxy without exposing it in argv or inheriting secrets", () => {
    vi.stubEnv("HTTP_PROXY", "http://untrusted-proxy.invalid:8080");
    vi.stubEnv("RCLONE_HTTP_PROXY", "http://untrusted-proxy.invalid:8080");
    vi.stubEnv("NO_PROXY", "*");
    vi.stubEnv("DATABASE_URL", "postgresql://user:database-secret@db/crewqual");
    vi.stubEnv("SETTINGS_ENCRYPTION_KEY", "settings-secret-must-not-reach-child");
    vi.stubEnv("RCLONE_CONFIG_PASS", "inherited-config-secret");

    const proxy = "http://proxy-token:proxy-token@127.0.0.1:32123";
    const invocation = rcloneInvocation(
      "/tmp/private-rclone.conf",
      ["copyto", "/tmp/archive", "crewqual:backups/archive"],
      proxy,
    );

    expect(invocation.args).toEqual([
      "--config",
      "/tmp/private-rclone.conf",
      "copyto",
      "/tmp/archive",
      "crewqual:backups/archive",
    ]);
    expect(JSON.stringify(invocation.args)).not.toContain("proxy-token");
    expect(invocation.env.RCLONE_HTTP_PROXY).toBe(proxy);
    for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] as const) {
      expect(invocation.env[name]).toBe(proxy);
    }
    expect(invocation.env.NO_PROXY).toBe("");
    expect(invocation.env.no_proxy).toBe("");
    for (const name of ["DATABASE_URL", "SETTINGS_ENCRYPTION_KEY", "RCLONE_CONFIG_PASS"] as const) {
      expect(invocation.env[name]).toBeUndefined();
    }
  });
});
