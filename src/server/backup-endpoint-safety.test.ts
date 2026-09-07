import { describe, expect, it } from "vitest";
import type { ServerConfig } from "@/server/config";
import { backupTargetPolicyUrl, checkBackupEndpoint } from "@/server/backup-endpoint-safety";

function config(overrides: Partial<ServerConfig> = {}) {
  return {
    NODE_ENV: "production",
    OUTBOUND_ALLOWED_HOSTS:
      "nas.internal:445,ftp.example.test:21,webdav.example.test,s3.example.test",
    OUTBOUND_ALLOWED_CIDRS: "",
    ...overrides,
  } as ServerConfig;
}

describe("remote backup endpoint policy", () => {
  it("normalizes host-only SMB and FTP targets for shared address validation", () => {
    expect(backupTargetPolicyUrl("SMB", "nas.internal")).toBe("https://nas.internal:445");
    expect(backupTargetPolicyUrl("FTP", "ftp.example.test")).toBe("https://ftp.example.test:21");
  });

  it("requires every production remote target in the deployment host allowlist", () => {
    expect(checkBackupEndpoint("SMB", "nas.internal", config())).toEqual({ ok: true });
    expect(checkBackupEndpoint("S3", "https://s3.example.test", config())).toEqual({ ok: true });
    expect(checkBackupEndpoint("S3", "https://attacker.example.test", config()).ok).toBe(false);
  });

  it("rejects unsafe authority syntax and non-HTTP WebDAV/S3 URLs", () => {
    expect(checkBackupEndpoint("SMB", "user@nas.internal", config()).ok).toBe(false);
    expect(checkBackupEndpoint("FTP", "ftp.example.test/path", config()).ok).toBe(false);
    expect(checkBackupEndpoint("WEBDAV", "file:///etc", config()).ok).toBe(false);
  });

  it("permits a private host only when deployment-owned", () => {
    expect(
      checkBackupEndpoint(
        "S3",
        "https://10.0.0.8:9443",
        config({ OUTBOUND_ALLOWED_HOSTS: "10.0.0.8:9443" }),
      ),
    ).toEqual({ ok: true });
    expect(
      checkBackupEndpoint("S3", "https://10.0.0.8:9443", config({ OUTBOUND_ALLOWED_HOSTS: "" })).ok,
    ).toBe(false);
  });
});
