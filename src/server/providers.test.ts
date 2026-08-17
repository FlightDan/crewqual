import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerConfigForTests } from "@/server/config";
import { getFeishuAdapter, getSmsAdapter } from "@/server/providers";

describe("notification provider adapters", () => {
  beforeEach(() => {
    process.env.SERVICE_MODE = "remote";
    process.env.SMS_ADAPTER = "webhook";
    process.env.SMS_WEBHOOK_URL = "http://sms.test/send";
    process.env.SMS_WEBHOOK_AUTH_TOKEN = "secret";
    resetServerConfigForTests();
    vi.restoreAllMocks();
  });

  it("sends the stable SMS contract through a webhook adapter", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted: true, providerId: "sms-42" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSmsAdapter().send({
      mobile: "13800138000",
      message: "测试消息",
      idempotencyKey: "event:pilot:sms",
    });

    expect(result).toEqual({ accepted: true, providerId: "sms-42" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://sms.test/send",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer secret",
          "idempotency-key": "event:pilot:sms",
        },
        body: JSON.stringify({
          mobile: "13800138000",
          message: "测试消息",
          idempotencyKey: "event:pilot:sms",
        }),
      }),
    );
  });

  it("keeps disabled delivery explicit instead of reporting success", async () => {
    process.env.SMS_ADAPTER = "disabled";
    resetServerConfigForTests();
    await expect(
      getSmsAdapter().send({ mobile: "13800138000", message: "测试消息" }),
    ).resolves.toEqual({ accepted: false });
  });

  it("turns every notification adapter into a no-op under the external-call guard", async () => {
    process.env.SMS_ADAPTER = "webhook";
    process.env.SMS_WEBHOOK_URL = "https://sms.example.test/send";
    process.env.FEISHU_ADAPTER = "webhook";
    process.env.FEISHU_WEBHOOK_URL = "https://feishu.example.test/send";
    process.env.CREWQUAL_TEST_NO_EXTERNAL = "1";
    resetServerConfigForTests();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getSmsAdapter().send({ mobile: "13800138000", message: "测试消息" }),
    ).resolves.toEqual({ accepted: false });
    await expect(
      getFeishuAdapter().send({ target: "pilot@example.test", message: "测试消息" }),
    ).resolves.toEqual({ accepted: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never calls configured notification providers in mock mode", async () => {
    process.env.SERVICE_MODE = "mock";
    process.env.SMS_ADAPTER = "webhook";
    process.env.SMS_WEBHOOK_URL = "https://sms.example.test/send";
    process.env.FEISHU_ADAPTER = "webhook";
    process.env.FEISHU_WEBHOOK_URL = "https://feishu.example.test/send";
    resetServerConfigForTests();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getSmsAdapter().send({ mobile: "13800138000", message: "测试消息" }),
    ).resolves.toEqual({ accepted: false });
    await expect(
      getFeishuAdapter().send({ target: "pilot@example.test", message: "测试消息" }),
    ).resolves.toEqual({ accepted: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
