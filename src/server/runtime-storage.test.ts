import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSettingSecret } from "@/server/crypto";
import { resetServerConfigForTests } from "@/server/config";
import {
  getRuntimeStorageConfig,
  resolveSetupStorage,
  storageLocationChanged,
  storageSettingData,
} from "@/server/runtime-storage";

const prismaFindUnique = vi.hoisted(() => vi.fn());
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({ objectStorageSetting: { findUnique: prismaFindUnique } }),
}));

const originalEnv = { ...process.env };

describe("runtime object storage configuration", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      SESSION_SECRET: "test-session-secret-that-is-long-enough",
      READINESS_PROBE_SECRET: "test-readiness-probe-secret-0123456789",
      SETTINGS_ENCRYPTION_KEY: "test-storage-settings-encryption-key",
    };
    prismaFindUnique.mockReset();
    resetServerConfigForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetServerConfigForTests();
  });

  it("encrypts external S3 credentials before persistence", () => {
    const stored = storageSettingData({
      mode: "s3",
      endpoint: "https://s3.example.com/",
      region: "us-east-1",
      bucket: "crewqual-private",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key-value",
      forcePathStyle: false,
      sseKmsKeyId: "",
    });
    expect(stored.credentialsCiphertext).not.toContain("secret-key-value");
    expect(JSON.parse(decryptSettingSecret(stored.credentialsCiphertext!))).toEqual({
      accessKeyId: "access-key",
      secretAccessKey: "secret-key-value",
    });
  });

  it("normalizes the external endpoint and preserves S3 options", () => {
    expect(
      resolveSetupStorage({
        mode: "s3",
        endpoint: "https://s3.example.com/",
        region: "cn-north-1",
        bucket: "evidence",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key-value",
        forcePathStyle: true,
        sseKmsKeyId: "kms-key",
      }),
    ).toMatchObject({
      mode: "s3",
      S3_ENDPOINT: "https://s3.example.com",
      S3_REGION: "cn-north-1",
      S3_BUCKET: "evidence",
      S3_FORCE_PATH_STYLE: true,
      S3_SSE_KMS_KEY_ID: "kms-key",
    });
  });

  it("rejects an HTTP external S3 endpoint in production", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      SERVICE_MODE: "remote",
      APP_ORIGIN: "https://crewqual.example.test",
      DATABASE_URL: "postgresql://crewqual:test@postgres/crewqual",
      SESSION_SECRET: "production-session-secret-that-is-long-enough-1234567890",
      SETTINGS_ENCRYPTION_KEY: "production-settings-key-that-is-distinct",
      TRUSTED_PROXY_HOPS: "1",
      STORAGE_MODE: "builtin",
      S3_ENDPOINT: "http://minio:9000",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "production-storage-secret",
      OUTBOUND_ALLOWED_HOSTS: "external-s3.example.test",
    });
    resetServerConfigForTests();

    expect(() =>
      resolveSetupStorage({
        mode: "s3",
        endpoint: "http://external-s3.example.test",
        region: "us-east-1",
        bucket: "evidence",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key-value",
        forcePathStyle: false,
      }),
    ).toThrow("必须使用 HTTPS");
  });

  it("requires a deployment-owned host entry for production external S3", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      SERVICE_MODE: "remote",
      APP_ORIGIN: "https://crewqual.example.test",
      DATABASE_URL: "postgresql://crewqual:test@postgres/crewqual",
      SESSION_SECRET: "production-session-secret-that-is-long-enough-1234567890",
      SETTINGS_ENCRYPTION_KEY: "production-settings-key-that-is-distinct",
      TRUSTED_PROXY_HOPS: "1",
      STORAGE_MODE: "builtin",
      S3_ENDPOINT: "http://minio:9000",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "production-storage-secret",
      OUTBOUND_ALLOWED_HOSTS: "minio:9000",
    });
    resetServerConfigForTests();

    expect(() =>
      resolveSetupStorage({
        mode: "s3",
        endpoint: "https://unapproved-s3.example.test",
        region: "us-east-1",
        bucket: "evidence",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key-value",
        forcePathStyle: false,
      }),
    ).toThrow("主机白名单");
  });

  it("falls back to environment storage until a database setting exists", async () => {
    Object.assign(process.env, {
      NODE_ENV: "development",
      SERVICE_MODE: "remote",
      DATABASE_URL: "postgresql://crewqual:test@postgres/crewqual",
      STORAGE_MODE: "external",
      S3_ENDPOINT: "https://environment-s3.example.test",
      S3_REGION: "us-east-1",
      S3_BUCKET: "environment-bucket",
      S3_ACCESS_KEY_ID: "environment-access",
      S3_SECRET_ACCESS_KEY: "environment-secret",
    });
    resetServerConfigForTests();
    prismaFindUnique.mockResolvedValue(null);

    await expect(getRuntimeStorageConfig()).resolves.toMatchObject({
      mode: "environment",
      S3_ENDPOINT: "https://environment-s3.example.test",
      S3_BUCKET: "environment-bucket",
    });
  });

  it("prefers encrypted database storage and locks endpoint or bucket changes", async () => {
    Object.assign(process.env, {
      NODE_ENV: "development",
      SERVICE_MODE: "remote",
      DATABASE_URL: "postgresql://crewqual:test@postgres/crewqual",
      S3_ENDPOINT: "https://environment-s3.example.test",
      S3_BUCKET: "environment-bucket",
    });
    resetServerConfigForTests();
    const stored = storageSettingData({
      mode: "s3",
      endpoint: "https://database-s3.example.test/",
      region: "cn-north-1",
      bucket: "database-bucket",
      accessKeyId: "database-access",
      secretAccessKey: "database-secret",
      forcePathStyle: true,
    });
    prismaFindUnique.mockResolvedValue({ id: "global", ...stored });

    const current = await getRuntimeStorageConfig();
    expect(current).toMatchObject({
      mode: "s3",
      S3_ENDPOINT: "https://database-s3.example.test",
      S3_BUCKET: "database-bucket",
      S3_ACCESS_KEY_ID: "database-access",
    });
    expect(
      storageLocationChanged(current, { ...current, S3_ENDPOINT: `${current.S3_ENDPOINT}/` }),
    ).toBe(false);
    expect(storageLocationChanged(current, { ...current, S3_BUCKET: "another-bucket" })).toBe(true);
  });
});
