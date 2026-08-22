import { describe, expect, it } from "vitest";
import { setupCompleteSchema, validateSetupBackupTarget } from "@/server/setup";
import type { SetupCompleteInput } from "@/types/setup";

function validSetupInput(): SetupCompleteInput {
  return {
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    organizationName: "测试航空公司",
    storage: { mode: "builtin" },
    admin: {
      displayName: "系统管理员",
      email: "admin@example.com",
      password: "A-strong-password-123",
      requireTotp: false,
    },
    templatePackIds: [],
    backup: {
      enabled: true,
      targetName: "本地备份",
      targetType: "LOCAL",
      endpoint: "/backups",
      basePath: "crewqual",
    },
    notifications: {
      inApp: true,
      feishu: { enabled: false, endpoint: "" },
      sms: { enabled: false, endpoint: "" },
      routes: [{ key: "delivery_failed", channels: ["inApp"] }],
    },
  };
}

describe("setup validation", () => {
  it("accepts the safe local-backup preset", () => {
    expect(setupCompleteSchema.parse(validSetupInput()).backup.endpoint).toBe("/backups");
    expect(
      validateSetupBackupTarget({ type: "LOCAL", endpoint: "/backups", basePath: "crewqual" }),
    ).toEqual(expect.objectContaining({ ok: true }));
  });

  it("accepts built-in storage and validates external S3 fields", () => {
    expect(setupCompleteSchema.parse(validSetupInput()).storage).toEqual({ mode: "builtin" });
    const input = validSetupInput();
    input.storage = {
      mode: "s3",
      endpoint: "https://s3.example.com",
      region: "us-east-1",
      bucket: "crewqual-private",
      accessKeyId: "access",
      secretAccessKey: "secret-value",
      forcePathStyle: false,
    };
    expect(setupCompleteSchema.parse(input).storage.mode).toBe("s3");
  });

  it("requires the verified enrollment token when TOTP is enabled", () => {
    const input = validSetupInput();
    input.admin.requireTotp = true;
    const result = setupCompleteSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.join(".") === "admin.verifiedTotpToken"),
    ).toBe(true);
  });

  it("rejects local backup paths outside the worker volume", () => {
    const input = validSetupInput();
    input.backup.endpoint = "/var/backups/crewqual";
    const result = setupCompleteSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join(".") === "backup.endpoint")).toBe(
      true,
    );
  });

  it("rejects routes that reference disabled channels", () => {
    const input = validSetupInput();
    input.notifications.routes = [{ key: "delivery_failed", channels: ["sms"] }];
    const result = setupCompleteSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes("未启用的通知渠道"))).toBe(
      true,
    );
  });
});
