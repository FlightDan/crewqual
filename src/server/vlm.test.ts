import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchExternalEndpoint, readVerifiedEvidence } = vi.hoisted(() => ({
  fetchExternalEndpoint: vi.fn(),
  readVerifiedEvidence: vi.fn(),
}));
vi.mock("@/server/storage", () => ({ readVerifiedEvidence }));
vi.mock("@/server/external-endpoint-safety", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/external-endpoint-safety")>()),
  fetchExternalEndpoint,
}));

import { resetServerConfigForTests } from "@/server/config";
import { recognizeEvidence } from "@/server/vlm";
const evidence = {
  objectKey: "evidence/verified.jpg",
  mimeType: "image/jpeg",
  byteSize: 4,
  sha256: "a".repeat(64),
  storageEncodingVersion: 1,
  sanitizedAt: new Date(),
};

describe("Qwen OpenAI-compatible VLM adapter", () => {
  beforeEach(() => {
    process.env.SERVICE_MODE = "remote";
    process.env.SESSION_SECRET = "vlm-test-session-secret-0123456789abcdef012345";
    process.env.VLM_ADAPTER = "qwen";
    process.env.QWEN_BASE_URL = "http://qwen.test/v1";
    process.env.QWEN_MODEL = "Qwen3.7-35B";
    delete process.env.CREWQUAL_TEST_NO_EXTERNAL;
    readVerifiedEvidence.mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    resetServerConfigForTests();
    vi.clearAllMocks();
  });

  it("sends only a private JPEG as an OpenAI-compatible image message", async () => {
    fetchExternalEndpoint.mockResolvedValue(
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
    const result = await recognizeEvidence("evidence/verified.jpg", evidence);
    expect(result.available).toBe(true);
    expect(result.fields.expiryDate).toBe("2027-01-01");
    expect(fetchExternalEndpoint).toHaveBeenCalledWith(
      "http://qwen.test/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
      false,
      expect.objectContaining({ allowedCidrs: "", allowedHosts: "" }),
    );
    const body = JSON.parse(fetchExternalEndpoint.mock.calls[0]![1].body as string);
    expect(body.model).toBe("Qwen3.7-35B");
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("never turns malformed model JSON into an approval decision", async () => {
    fetchExternalEndpoint.mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"status":"approved"}' } }] }),
      ),
    );
    const result = await recognizeEvidence("evidence/verified.jpg", evidence);
    expect(result.available).toBe(false);
  });

  it("never calls the model when the test external-call guard is enabled", async () => {
    process.env.CREWQUAL_TEST_NO_EXTERNAL = "1";
    resetServerConfigForTests();
    await expect(recognizeEvidence("evidence/verified.jpg")).resolves.toMatchObject({
      available: false,
    });
    expect(fetchExternalEndpoint).not.toHaveBeenCalled();
  });

  it("does not read storage or call the model in mock mode", async () => {
    process.env.SERVICE_MODE = "mock";
    resetServerConfigForTests();
    await expect(recognizeEvidence("evidence/verified.jpg")).resolves.toMatchObject({
      available: false,
      provider: "disabled",
    });
    expect(readVerifiedEvidence).not.toHaveBeenCalled();
    expect(fetchExternalEndpoint).not.toHaveBeenCalled();
  });

  it("rejects missing or mismatched provenance before reading bytes or sending to the provider", async () => {
    await expect(recognizeEvidence(evidence.objectKey)).rejects.toMatchObject({ status: 404 });
    await expect(recognizeEvidence("evidence/other.jpg", evidence)).rejects.toMatchObject({
      status: 404,
    });
    expect(readVerifiedEvidence).not.toHaveBeenCalled();
    expect(fetchExternalEndpoint).not.toHaveBeenCalled();
  });
});
