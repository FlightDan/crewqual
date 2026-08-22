import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getServerConfig, resetServerConfigForTests } from "@/server/config";

const originalEnv = { ...process.env };

describe("server configuration safety", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    resetServerConfigForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetServerConfigForTests();
  });

  it("derives SERVICE_MODE from the public mode flag for deterministic mock tests", () => {
    delete process.env.SERVICE_MODE;
    process.env.NEXT_PUBLIC_SERVICE_MODE = "mock";

    expect(getServerConfig()).toMatchObject({ SERVICE_MODE: "mock" });
  });

  it("rejects mock mode in production after required secrets are present", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      SERVICE_MODE: "mock",
      APP_ORIGIN: "https://crewqual.example.test",
      DATABASE_URL: "postgresql://crewqual:test@db/crewqual",
      SESSION_SECRET: "production-session-secret-that-is-long-enough-1234567890",
      SETTINGS_ENCRYPTION_KEY: "production-settings-key-that-is-distinct",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "production-storage-secret",
      S3_ENDPOINT: "https://s3.example.test",
      SMS_ADAPTER: "webhook",
      SMS_WEBHOOK_URL: "https://sms.example.test/send",
    });

    expect(() => getServerConfig()).toThrow("Mock service mode is not allowed in production");
  });

  it("rejects production without a real SMS webhook endpoint", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      SERVICE_MODE: "remote",
      APP_ORIGIN: "https://crewqual.example.test",
      DATABASE_URL: "postgresql://crewqual:test@db/crewqual",
      SESSION_SECRET: "production-session-secret-that-is-long-enough-1234567890",
      SETTINGS_ENCRYPTION_KEY: "production-settings-key-that-is-distinct",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "production-storage-secret",
      S3_ENDPOINT: "https://s3.example.test",
      SMS_ADAPTER: "webhook",
    });
    delete process.env.SMS_WEBHOOK_URL;

    expect(() => getServerConfig()).toThrow("SMS_WEBHOOK_URL is required");
  });

  it("allows SMS to remain disabled until the welcome wizard configures it", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      SERVICE_MODE: "remote",
      APP_ORIGIN: "https://crewqual.example.test",
      DATABASE_URL: "postgresql://crewqual:test@db/crewqual",
      SESSION_SECRET: "production-session-secret-that-is-long-enough-1234567890",
      SETTINGS_ENCRYPTION_KEY: "production-settings-key-that-is-distinct",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "production-storage-secret",
      S3_ENDPOINT: "https://s3.example.test",
      SMS_ADAPTER: "disabled",
    });

    expect(getServerConfig()).toMatchObject({ SMS_ADAPTER: "disabled" });
  });

  it("allows only the trusted internal MinIO HTTP endpoint in builtin mode", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      SERVICE_MODE: "remote",
      APP_ORIGIN: "https://crewqual.example.test",
      DATABASE_URL: "postgresql://crewqual:test@db/crewqual",
      SESSION_SECRET: "production-session-secret-that-is-long-enough-1234567890",
      SETTINGS_ENCRYPTION_KEY: "production-settings-key-that-is-distinct",
      STORAGE_MODE: "builtin",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "production-storage-secret",
      S3_ENDPOINT: "http://minio:9000",
      SMS_ADAPTER: "disabled",
    });

    expect(getServerConfig()).toMatchObject({ STORAGE_MODE: "builtin" });
  });

  it("rejects production with incomplete storage credentials", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      SERVICE_MODE: "remote",
      APP_ORIGIN: "https://crewqual.example.test",
      DATABASE_URL: "postgresql://crewqual:test@db/crewqual",
      SESSION_SECRET: "production-session-secret-that-is-long-enough-1234567890",
      SETTINGS_ENCRYPTION_KEY: "production-settings-key-that-is-distinct",
      SMS_ADAPTER: "webhook",
      SMS_WEBHOOK_URL: "https://sms.example.test/send",
      S3_ENDPOINT: "https://s3.example.test",
    });
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;

    expect(() => getServerConfig()).toThrow("Missing production configuration");
  });

  it("rejects a non-HTTPS or path-bearing production origin", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      SERVICE_MODE: "remote",
      APP_ORIGIN: "http://crewqual.example.test/admin",
      DATABASE_URL: "postgresql://crewqual:test@db/crewqual",
      SESSION_SECRET: "production-session-secret-that-is-long-enough-1234567890",
      SETTINGS_ENCRYPTION_KEY: "production-settings-key-that-is-distinct",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "production-storage-secret",
      S3_ENDPOINT: "https://s3.example.test",
      SMS_ADAPTER: "webhook",
      SMS_WEBHOOK_URL: "https://sms.example.test/send",
    });

    expect(() => getServerConfig()).toThrow("APP_ORIGIN must be an exact HTTPS origin");
  });

  it("allows a private HTTP origin for LAN deployments", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      SERVICE_MODE: "remote",
      DEPLOYMENT_NETWORK_MODE: "lan",
      APP_ORIGIN: "http://192.168.1.20:8080",
      DATABASE_URL: "postgresql://crewqual:test@db/crewqual",
      SESSION_SECRET: "production-session-secret-that-is-long-enough-1234567890",
      SETTINGS_ENCRYPTION_KEY: "production-settings-key-that-is-distinct",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "production-storage-secret",
      S3_ENDPOINT: "https://s3.example.test",
      SMS_ADAPTER: "webhook",
      SMS_WEBHOOK_URL: "https://sms.example.test/send",
    });

    expect(getServerConfig()).toMatchObject({
      APP_ORIGIN: "http://192.168.1.20:8080",
      DEPLOYMENT_NETWORK_MODE: "lan",
    });
  });

  it("rejects a public HTTP origin even when LAN mode is selected", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      SERVICE_MODE: "remote",
      DEPLOYMENT_NETWORK_MODE: "lan",
      APP_ORIGIN: "http://example.com:8080",
      DATABASE_URL: "postgresql://crewqual:test@db/crewqual",
      SESSION_SECRET: "production-session-secret-that-is-long-enough-1234567890",
      SETTINGS_ENCRYPTION_KEY: "production-settings-key-that-is-distinct",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "production-storage-secret",
      S3_ENDPOINT: "https://s3.example.test",
      SMS_ADAPTER: "webhook",
      SMS_WEBHOOK_URL: "https://sms.example.test/send",
    });

    expect(() => getServerConfig()).toThrow("APP_ORIGIN must be an exact HTTPS origin");
  });

  it("rejects short or reused production encryption material", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      SERVICE_MODE: "remote",
      APP_ORIGIN: "https://crewqual.example.test",
      DATABASE_URL: "postgresql://crewqual:test@db/crewqual",
      SESSION_SECRET: "same-production-secret-that-is-definitely-long-enough-1234",
      SETTINGS_ENCRYPTION_KEY: "same-production-secret-that-is-definitely-long-enough-1234",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "production-storage-secret",
      S3_ENDPOINT: "https://s3.example.test",
      SMS_ADAPTER: "webhook",
      SMS_WEBHOOK_URL: "https://sms.example.test/send",
    });

    expect(() => getServerConfig()).toThrow("SETTINGS_ENCRYPTION_KEY");
  });
});
