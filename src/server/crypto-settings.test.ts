import { beforeEach, describe, expect, it } from "vitest";
import { resetServerConfigForTests } from "@/server/config";
import { decryptSettingSecret, encryptSettingSecret } from "@/server/crypto";

describe("encrypted system setting secrets", () => {
  beforeEach(() => {
    process.env.SETTINGS_ENCRYPTION_KEY = "test-only-settings-encryption-key";
    resetServerConfigForTests();
  });

  it("round-trips a secret without embedding plaintext in storage", () => {
    const encrypted = encryptSettingSecret("credential-value");
    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain("credential-value");
    expect(decryptSettingSecret(encrypted)).toBe("credential-value");
  });
});
