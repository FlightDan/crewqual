import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  updateMany: vi.fn(),
  encryptSettingSecret: vi.fn((value: string) => `encrypted:${value}`),
  decryptSettingSecret: vi.fn(),
  createOpaqueToken: vi.fn(() => "generated-encryption-key"),
}));

vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({
    backupTarget: {
      findUnique: mocks.findUnique,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
      updateMany: mocks.updateMany,
    },
  }),
}));
vi.mock("@/server/crypto", () => ({
  encryptSettingSecret: mocks.encryptSettingSecret,
  decryptSettingSecret: mocks.decryptSettingSecret,
  createOpaqueToken: mocks.createOpaqueToken,
}));
vi.mock("@/server/admin-permissions", () => ({ isSuperAdmin: () => true }));
vi.mock("@/server/backup-endpoint-safety", () => ({
  checkBackupEndpoint: () => ({ ok: true }),
}));
vi.mock("@/server/config", () => ({ getServerConfig: () => ({}) }));

import { saveBackupTarget } from "@/server/backup-service";

const admin = {} as Parameters<typeof saveBackupTarget>[0];
const current = {
  id: "target-1",
  name: "S3",
  type: "S3",
  endpoint: "https://s3.example.test",
  basePath: "backups",
  encryptionEnabled: true,
  active: true,
  secretCiphertext: "encrypted-current",
  version: 1,
  lastTestedAt: null,
  lastTestMessage: "",
};

describe("backup target updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(current);
    mocks.findUniqueOrThrow.mockResolvedValue({ ...current, version: 2 });
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("rejects changing the protocol before validating or persisting credentials", async () => {
    await expect(
      saveBackupTarget(admin, {
        ...current,
        type: "FTP",
        secret: '{"username":"ops","password":"new"}',
      }),
    ).rejects.toMatchObject({ code: "BACKUP_TARGET_TYPE_IMMUTABLE", status: 409 });
    expect(mocks.decryptSettingSecret).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("preserves the legacy artifact key when transport credentials rotate", async () => {
    const legacySecret = '{"accessKeyId":"old","secretAccessKey":"old-secret"}';
    mocks.decryptSettingSecret.mockReturnValue(legacySecret);

    await saveBackupTarget(admin, {
      ...current,
      secret: '{"accessKeyId":"new","secretAccessKey":"new-secret"}',
    });

    const encryptedValue = mocks.encryptSettingSecret.mock.calls[0]![0];
    expect(JSON.parse(encryptedValue)).toEqual({
      accessKeyId: "new",
      secretAccessKey: "new-secret",
      encryptionKey: legacySecret,
    });
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: current.id, version: current.version },
        data: expect.objectContaining({ secretCiphertext: `encrypted:${encryptedValue}` }),
      }),
    );
  });

  it("refuses an explicit encryption-key rotation on an encrypted target", async () => {
    mocks.decryptSettingSecret.mockReturnValue(
      '{"accessKeyId":"old","secretAccessKey":"old-secret","encryptionKey":"stable-key"}',
    );
    await expect(
      saveBackupTarget(admin, {
        ...current,
        secret:
          '{"accessKeyId":"new","secretAccessKey":"new-secret","encryptionKey":"rotated-key"}',
      }),
    ).rejects.toMatchObject({ code: "BACKUP_ENCRYPTION_KEY_IMMUTABLE", status: 409 });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("preserves a legacy artifact key across encryption off and on", async () => {
    const legacySecret = '{"accessKeyId":"old","secretAccessKey":"old-secret"}';
    mocks.findUnique.mockResolvedValue({ ...current, encryptionEnabled: false });
    mocks.decryptSettingSecret.mockReturnValue(legacySecret);

    await saveBackupTarget(admin, {
      ...current,
      encryptionEnabled: true,
      secret: "",
    });

    const encryptedValue = mocks.encryptSettingSecret.mock.calls[0]![0];
    expect(JSON.parse(encryptedValue)).toEqual({
      accessKeyId: "old",
      secretAccessKey: "old-secret",
      encryptionKey: legacySecret,
    });
  });

  it("preserves the artifact key when credentials rotate while encryption is disabled", async () => {
    const legacySecret = '{"accessKeyId":"old","secretAccessKey":"old-secret"}';
    mocks.findUnique.mockResolvedValue({ ...current, encryptionEnabled: false });
    mocks.decryptSettingSecret.mockReturnValue(legacySecret);

    await saveBackupTarget(admin, {
      ...current,
      encryptionEnabled: false,
      secret: '{"accessKeyId":"new","secretAccessKey":"new-secret"}',
    });

    const encryptedValue = mocks.encryptSettingSecret.mock.calls[0]![0];
    expect(JSON.parse(encryptedValue)).toEqual({
      accessKeyId: "new",
      secretAccessKey: "new-secret",
      encryptionKey: legacySecret,
    });
  });
});
