import { describe, expect, it, vi } from "vitest";

const endpointGuard = vi.hoisted(() => vi.fn());
const prisma = vi.hoisted(() => ({
  backupRun: {
    updateMany: vi.fn(),
  },
  backupTarget: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("@/server/backup-endpoint-safety", () => ({
  assertBackupEndpointResolved: endpointGuard,
}));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => prisma,
}));

import {
  assertArtifactChecksum,
  assertBackupCredentialJsonSafe,
  applyGalleryManifest,
  assertRestoreIsolation,
  assertGalleryArchiveContents,
  assertGalleryObjectSet,
  assertSafeArchiveMembers,
  assertSafeObjectKey,
  backupArtifactName,
  normalizeRemoteBackupBasePath,
  parseGalleryManifest,
  postgresClientEnvironment,
  recoverStaleBackupRuns,
  selectGalleryRestoreRuns,
  testBackupTarget,
} from "@/server/backup-runner";
import {
  backupArtifactEncryptionSecret,
  parseBackupCredentials,
  serializeRemoteCredentialsWithEncryptionKey,
} from "@/server/backup-credential";

const buildListing = (names: string[]) => names.join("\n");

const verboseFor = (names: string[], types: string[]) =>
  names.map((name, index) => `${types[index]} root/root 1 2024-01-01 00:00 ${name}`).join("\n");

describe("offline restore archive validation", () => {
  it("requires an isolated database and object-storage bucket", () => {
    expect(() =>
      assertRestoreIsolation({
        sourceDatabaseUrl: "postgresql://source:one@db:5432/crewqual?schema=public",
        restoreDatabaseUrl: "postgres://restore:two@db/crewqual?schema=recovery",
        sourceBucket: "evidence",
        restoreBucket: "recovery",
      }),
    ).toThrow("在线数据库");
    expect(() =>
      assertRestoreIsolation({
        sourceDatabaseUrl: "postgresql://source:one@db/crewqual",
        restoreDatabaseUrl: "postgresql://restore:two@db/recovery",
        sourceBucket: "evidence",
        restoreBucket: "evidence",
      }),
    ).toThrow("bucket 隔离");
    expect(() =>
      assertRestoreIsolation({
        sourceDatabaseUrl: "postgresql://source:one@db/crewqual",
        restoreDatabaseUrl: "postgresql://restore:two@db/recovery",
        sourceBucket: "evidence",
        restoreBucket: "recovery",
        backupBucket: "backup",
      }),
    ).not.toThrow();
  });

  it("requires a complete gallery baseline and checksum on every artifact", () => {
    const hash = "a".repeat(64);
    expect(() =>
      selectGalleryRestoreRuns("incremental", [
        { id: "incremental", mode: "INCREMENTAL", artifactPath: "/i", manifestSha256: hash },
      ]),
    ).toThrow("缺少完整备份基线");
    expect(() =>
      selectGalleryRestoreRuns("incremental", [
        { id: "full", mode: "FULL", artifactPath: "/f", manifestSha256: null },
        { id: "incremental", mode: "INCREMENTAL", artifactPath: "/i", manifestSha256: hash },
      ]),
    ).toThrow("缺少有效校验和");
    expect(
      selectGalleryRestoreRuns("incremental", [
        { id: "full", mode: "FULL", artifactPath: "/f", manifestSha256: hash },
        { id: "incremental", mode: "INCREMENTAL", artifactPath: "/i", manifestSha256: hash },
      ]).map((item) => item.id),
    ).toEqual(["full", "incremental"]);
  });

  it("refuses missing or mismatched artifact checksums", () => {
    const bytes = Buffer.from("verified backup");
    const hash = "033ea45728f0ba7ce7552bfc6ce49fff338e1269f45c72eded39cb3dc0371087";
    expect(() => assertArtifactChecksum(bytes, null)).toThrow("缺少有效");
    expect(() => assertArtifactChecksum(bytes, "0".repeat(64))).toThrow("校验失败");
    expect(() => assertArtifactChecksum(bytes, hash)).not.toThrow();
  });

  it("accepts the shape the backup path produces", () => {
    const names = [
      "manifest.json",
      "objects/",
      "objects/evidence/",
      "objects/evidence/2024-01-01/",
      "objects/evidence/2024-01-01/0f4f7e5a-1f6b-4a2a-9d2e-3f4a5b6c7d8e.jpg",
    ];
    const types = ["-rw-r--r--", "drwxr-xr-x", "drwxr-xr-x", "drwxr-xr-x", "-rw-r--r--"];
    expect(() =>
      assertSafeArchiveMembers(buildListing(names), verboseFor(names, types)),
    ).not.toThrow();
  });

  it("rejects traversal, absolute, backslash and control-character keys", () => {
    for (const member of [
      "objects/../secret.txt",
      "objects/evidence/../../secret.txt",
      "objects//etc/passwd",
      "objects/C:\\windows\\system32",
      "objects/evidence/x\n[extra]",
      "/etc/passwd",
      "manifest.json2",
    ]) {
      const names = ["manifest.json", member];
      const types = ["-rw-r--r--", "-rw-r--r--"];
      expect(() => assertSafeArchiveMembers(buildListing(names), verboseFor(names, types))).toThrow(
        /拒绝恢复/,
      );
    }
  });

  it("rejects symlink and hardlink members that would escape via readFile", () => {
    const names = ["manifest.json", "objects/evidence/2024-01-01/x.jpg"];
    const types = ["-rw-r--r--", "lrwxrwxrwx"];
    expect(() => assertSafeArchiveMembers(buildListing(names), verboseFor(names, types))).toThrow(
      "非常规成员",
    );
    const hardlinkTypes = ["-rw-r--r--", "hrw-r--r--"];
    expect(() =>
      assertSafeArchiveMembers(buildListing(names), verboseFor(names, hardlinkTypes)),
    ).toThrow("非常规成员");
  });

  it("rejects archives without a manifest or with an unparseable listing", () => {
    expect(() =>
      assertSafeArchiveMembers("objects/x.jpg", verboseFor(["objects/x.jpg"], ["-"])),
    ).toThrow("缺少 manifest.json");
    expect(() => assertSafeArchiveMembers("manifest.json\nobjects/x", "-rw-r--r--")).toThrow(
      "无法解析",
    );
  });

  it("validates manifest object keys directly", () => {
    expect(() => assertSafeObjectKey("evidence/2024-01-01/abc.jpg")).not.toThrow();
    expect(() => assertSafeObjectKey("../proc/1/environ")).toThrow();
    expect(() => assertSafeObjectKey("evidence//double")).toThrow();
    expect(() => assertSafeObjectKey("/abs/key.jpg")).toThrow();
  });

  it("applies tombstones and verifies the final object collection", () => {
    const hashA = "a".repeat(64);
    const hashB = "b".repeat(64);
    const full = parseGalleryManifest(
      {
        version: 2,
        mode: "FULL",
        createdAt: "2026-09-04T00:00:00.000Z",
        objects: [{ objectKey: "evidence/a.jpg", mimeType: "image/jpeg", sha256: hashA }],
        tombstones: [],
      },
      "FULL",
    );
    const incremental = parseGalleryManifest(
      {
        version: 2,
        mode: "INCREMENTAL",
        createdAt: "2026-09-04T01:00:00.000Z",
        objects: [{ objectKey: "evidence/b.avif", mimeType: "image/avif", sha256: hashB }],
        tombstones: [
          { objectKey: "evidence/a.jpg", deletedAt: "2026-09-04T00:30:00.000Z", reason: "DELETED" },
        ],
      },
      "INCREMENTAL",
    );
    const final = applyGalleryManifest(applyGalleryManifest(new Map(), full), incremental);
    expect([...final.keys()]).toEqual(["evidence/b.avif"]);
    expect(() =>
      assertGalleryObjectSet(final, [{ objectKey: "evidence/b.avif", sha256: hashB }]),
    ).not.toThrow();
    expect(() =>
      assertGalleryObjectSet(final, [{ objectKey: "evidence/a.jpg", sha256: hashA }]),
    ).toThrow("对象集合");
    expect(() =>
      parseGalleryManifest(
        {
          version: 2,
          mode: "INCREMENTAL",
          createdAt: "2026-09-04T01:00:00.000Z",
          objects: [{ objectKey: "evidence/a.jpg", mimeType: "image/jpeg", sha256: hashA }],
          tombstones: [
            {
              objectKey: "evidence/a.jpg",
              deletedAt: "2026-09-04T01:00:00.000Z",
              reason: "DELETED",
            },
          ],
        },
        "INCREMENTAL",
      ),
    ).toThrow("同时声明对象和删除");
    expect(() =>
      parseGalleryManifest(
        {
          version: 1,
          mode: "INCREMENTAL",
          createdAt: "2026-09-04T01:00:00.000Z",
          objects: [],
        },
        "INCREMENTAL",
      ),
    ).toThrow("旧版增量");
    expect(() =>
      parseGalleryManifest(
        {
          version: 2,
          mode: "FULL",
          createdAt: "2026-09-04T00:00:00.000Z",
          objects: [],
          tombstones: [
            {
              objectKey: "evidence/a.jpg",
              deletedAt: "2026-09-04T00:00:00.000Z",
              reason: "UNKNOWN",
            },
          ],
        },
        "FULL",
      ),
    ).toThrow("格式非法");
  });

  it("requires the archive file set to exactly match its manifest", () => {
    const manifest = parseGalleryManifest(
      {
        version: 2,
        mode: "FULL",
        createdAt: "2026-09-04T00:00:00.000Z",
        objects: [{ objectKey: "evidence/a.jpg", mimeType: "image/jpeg", sha256: "a".repeat(64) }],
        tombstones: [],
      },
      "FULL",
    );
    expect(() =>
      assertGalleryArchiveContents(manifest, "manifest.json\nobjects/\nobjects/evidence/a.jpg"),
    ).not.toThrow();
    expect(() =>
      assertGalleryArchiveContents(manifest, "manifest.json\nobjects/\nobjects/evidence/other.jpg"),
    ).toThrow("对象集合");
  });

  it("rejects unsafe remote base paths", () => {
    expect(normalizeRemoteBackupBasePath("crewqual/daily")).toBe("crewqual/daily");
    for (const value of [
      "../escape",
      "/absolute",
      "crewqual//daily",
      "crewqual\\daily",
      "crewqual:bucket",
    ]) {
      expect(() => normalizeRemoteBackupBasePath(value)).toThrow("相对路径");
    }
  });
});

describe("backup credential JSON validation", () => {
  it("accepts the existing protocol credential formats", () => {
    expect(parseBackupCredentials("SMB", '{"username":"ops","password":"secret"}')).toEqual({
      type: "SMB",
      values: { username: "ops", password: "secret" },
    });
    expect(
      parseBackupCredentials(
        "FTP",
        '{"username":"ops","password":"secret","tls":"false","passivePortRange":"30000-30100"}',
      ),
    ).toEqual({
      type: "FTP",
      values: {
        username: "ops",
        password: "secret",
        tls: "false",
        passivePortRange: "30000-30100",
      },
    });
    expect(parseBackupCredentials("WEBDAV", '{"username":"ops","password":"secret"}')).toEqual({
      type: "WEBDAV",
      values: { username: "ops", password: "secret" },
    });
    expect(
      parseBackupCredentials("S3", '{"accessKeyId":"access","secretAccessKey":"secret"}'),
    ).toEqual({
      type: "S3",
      values: { accessKeyId: "access", secretAccessKey: "secret" },
    });
    expect(parseBackupCredentials("LOCAL", "opaque-encryption-key")).toEqual({
      type: "LOCAL",
      secret: "opaque-encryption-key",
    });
  });

  it("rejects non-object JSON credential values", () => {
    for (const value of ["null", "[]", "123", '"secret"']) {
      expect(() => parseBackupCredentials("SMB", value)).toThrow("普通对象");
    }
  });

  it("rejects unknown fields and non-string fields per protocol", () => {
    expect(() => parseBackupCredentials("SMB", '{"accessKeyId":"access"}')).toThrow(
      "凭据格式不合法",
    );
    expect(() => parseBackupCredentials("S3", '{"region":"cn"}')).toThrow("凭据格式不合法");
    expect(() => parseBackupCredentials("FTP", '{"tls":false}')).toThrow("凭据格式不合法");
    expect(() => parseBackupCredentials("WEBDAV", '{"password":123}')).toThrow("凭据格式不合法");
  });

  it("surfaces invalid credentials as a 422 API validation error", () => {
    const thrown = (() => {
      try {
        parseBackupCredentials("S3", '{"accessKeyId":123}');
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(thrown).toMatchObject({
      code: "INVALID_BACKUP_CREDENTIALS",
      status: 422,
    });
  });

  it("rejects control characters in every credential field", () => {
    expect(() => parseBackupCredentials("SMB", '{"username":"ops\\n[sneaky]\\ntype=smb"}')).toThrow(
      "用户名",
    );
    expect(() => parseBackupCredentials("S3", '{"accessKeyId":"AKIA\\nROsie"}')).toThrow(
      "凭据格式不合法",
    );
    expect(() => parseBackupCredentials("FTP", '{"tls":"true\\t"}')).toThrow("凭据格式不合法");
    expect(() => parseBackupCredentials("WEBDAV", '{"username":"ops\\u007f"}')).toThrow(
      "凭据格式不合法",
    );
  });

  it("rejects ambiguous config values before saving them", () => {
    expect(() => parseBackupCredentials("SMB", '{"username":" ops"}')).toThrow("凭据格式不合法");
    expect(() => parseBackupCredentials("S3", '{"accessKeyId":"access "}')).toThrow(
      "凭据格式不合法",
    );
    expect(() =>
      parseBackupCredentials("S3", '{"accessKeyId":"access","secretAccessKey":" secret "}'),
    ).toThrow("凭据格式不合法");
    expect(() =>
      parseBackupCredentials("S3", '{"username":"access","password":" secret "}'),
    ).toThrow("凭据格式不合法");
    expect(() => parseBackupCredentials("FTP", '{"tls":"yes"}')).toThrow("凭据格式不合法");
    expect(() => parseBackupCredentials("FTP", '{"passivePortRange":"21-20"}')).toThrow(
      "凭据格式不合法",
    );
    expect(() => parseBackupCredentials("SMB", '{"password":" secret "}')).not.toThrow();
  });

  it("accepts empty optional credentials and keeps the setup compatibility entry point", () => {
    expect(parseBackupCredentials("S3", undefined)).toEqual({ type: "S3", values: {} });
    expect(() => assertBackupCredentialJsonSafe('{"username":"ops"}')).not.toThrow();
    expect(() => assertBackupCredentialJsonSafe(undefined)).not.toThrow();
    expect(() => assertBackupCredentialJsonSafe('{"encryptionKey":"opaque-key"}')).not.toThrow();
    expect(() => assertBackupCredentialJsonSafe("not json")).toThrow("JSON");
  });

  it("keeps artifact encryption independent from rotated remote credentials", () => {
    const legacySecret = '{"username":"ops","password":"old"}';
    expect(
      backupArtifactEncryptionSecret(parseBackupCredentials("SMB", legacySecret), legacySecret),
    ).toBe(legacySecret);

    const parsed = parseBackupCredentials(
      "S3",
      '{"accessKeyId":"access","secretAccessKey":"transport","encryptionKey":"stable"}',
    );
    expect(backupArtifactEncryptionSecret(parsed, "serialized transport credentials")).toBe(
      "stable",
    );
    if (parsed.type === "LOCAL") throw new Error("expected remote credentials");
    expect(JSON.parse(serializeRemoteCredentialsWithEncryptionKey(parsed, "generated"))).toEqual({
      accessKeyId: "access",
      secretAccessKey: "transport",
      encryptionKey: "stable",
    });
  });

  it("re-resolves every remote endpoint before invoking rclone", async () => {
    endpointGuard.mockReset();
    endpointGuard.mockRejectedValue(new Error("endpoint guard blocked"));
    const target = {
      id: "target-1",
      type: "SMB",
      endpoint: "backup.example.com",
      basePath: "crewqual",
      secretCiphertext: null,
    };
    prisma.backupTarget.findUnique.mockResolvedValue(target);
    prisma.backupTarget.update.mockResolvedValue(target);

    const result = await testBackupTarget(target.id);

    expect(result).toMatchObject({ ok: false, message: "endpoint guard blocked" });
    expect(endpointGuard).toHaveBeenCalledWith("SMB", target.endpoint, expect.any(Object));
  });

  it("requeues only stale RUNNING runs with an atomic state transition", async () => {
    prisma.backupRun.updateMany.mockResolvedValue({ count: 1 });
    const now = new Date("2026-09-04T04:00:00.000Z");
    await recoverStaleBackupRuns(now);
    expect(prisma.backupRun.updateMany).toHaveBeenCalledWith({
      where: {
        status: "RUNNING",
        OR: [{ startedAt: null }, { startedAt: { lt: new Date("2026-09-04T02:00:00.000Z") } }],
      },
      data: {
        status: "QUEUED",
        startedAt: null,
        completedAt: null,
        errorMessage: null,
      },
    });
  });

  it("uses a claim-specific artifact name to fence stale workers", () => {
    const first = backupArtifactName(
      "DATABASE",
      "run-1",
      new Date("2026-09-04T01:00:00.000Z"),
      true,
    );
    const reclaimed = backupArtifactName(
      "DATABASE",
      "run-1",
      new Date("2026-09-04T03:01:00.000Z"),
      true,
    );
    expect(first).not.toBe(reclaimed);
    expect(first).toMatch(/^database-run-1-\d+\.enc$/);
  });

  it("decomposes PostgreSQL URLs and strips unrelated child-process secrets", () => {
    const url = "postgresql://user:s%40cret@db:6543/crewqual?sslmode=require";
    expect(
      postgresClientEnvironment(url, {
        NODE_ENV: "test",
        PATH: "/usr/bin",
        SESSION_SECRET: "must-not-leak",
        DATABASE_URL: url,
      }),
    ).toEqual({
      PATH: "/usr/bin",
      PGHOST: "db",
      PGPORT: "6543",
      PGDATABASE: "crewqual",
      PGUSER: "user",
      PGPASSWORD: "s@cret",
      PGSSLMODE: "require",
    });
  });

  it("rejects an unsafe historical local target again at execution time", async () => {
    const target = {
      id: "target-local",
      type: "LOCAL",
      endpoint: "/tmp",
      basePath: "legacy",
      secretCiphertext: null,
    };
    prisma.backupTarget.findUnique.mockResolvedValue(target);
    prisma.backupTarget.update.mockResolvedValue(target);

    const result = await testBackupTarget(target.id);

    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain("/backups");
  });
});
