import { beforeEach, describe, expect, it, vi } from "vitest";

const { readPrivateEvidence } = vi.hoisted(() => ({ readPrivateEvidence: vi.fn() }));
vi.mock("@/server/storage", () => ({ readPrivateEvidence }));

import { resetServerConfigForTests } from "@/server/config";
import { recognizeEvidence } from "@/server/vlm";

describe("Qwen OpenAI-compatible VLM adapter", () => {
  beforeEach(() => {
    process.env.SERVICE_MODE = "remote";
    process.env.VLM_ADAPTER = "qwen";
    process.env.QWEN_BASE_URL = "http://qwen.test/v1";
    process.env.QWEN_MODEL = "Qwen3.7-35B";
    readPrivateEvidence.mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    resetServerConfigForTests();
    vi.clearAllMocks();
  });

  it("sends only a private JPEG as an OpenAI-compatible image message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  available: true,
                  confidence: 0.94,
                  summary: "日期字段与提交内容一致",
                  fields: { issueDate: "2026-01-01", expiryDate: "2027-01-01" },
                }),
              },
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await recognizeEvidence("evidence/verified.jpg");
    expect(result.available).toBe(true);
    expect(result.fields.expiryDate).toBe("2027-01-01");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://qwen.test/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.model).toBe("Qwen3.7-35B");
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("never turns malformed model JSON into an approval decision", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ choices: [{ message: { content: '{"status":"approved"}' } }] }),
          ),
        ),
    );
    const result = await recognizeEvidence("evidence/verified.jpg");
    expect(result.available).toBe(false);
  });

  it("never calls the model when the test external-call guard is enabled", async () => {
    process.env.CREWQUAL_TEST_NO_EXTERNAL = "1";
    resetServerConfigForTests();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(recognizeEvidence("evidence/verified.jpg")).resolves.toMatchObject({
      available: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not read storage or call the model in mock mode", async () => {
    process.env.SERVICE_MODE = "mock";
    resetServerConfigForTests();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(recognizeEvidence("evidence/verified.jpg")).resolves.toMatchObject({
      available: false,
      provider: "disabled",
    });
    expect(readPrivateEvidence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
