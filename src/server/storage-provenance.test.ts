import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn(), sign: vi.fn() }));
vi.mock("@/server/s3-client", () => ({ createPinnedS3Client: () => ({ send: mocks.send }) }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.sign }));
vi.mock("@/server/config", () => ({ getServerConfig: () => ({ SERVICE_MODE: "remote" }) }));
vi.mock("@/server/runtime-storage", () => ({
  getRuntimeStorageConfig: () => ({ S3_BUCKET: "private" }),
}));
import { getPrivateEvidenceUrl, readVerifiedEvidence } from "@/server/storage";

const bytes = new Uint8Array([1, 2, 3]);
const evidence = {
  objectKey: "evidence/test.jpg",
  mimeType: "image/jpeg",
  byteSize: 3,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  storageEncodingVersion: 1,
  sanitizedAt: new Date(),
};

describe("private evidence storage gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sign.mockResolvedValue("signed-url");
  });
  it("does not access storage or sign old/unproven objects", async () => {
    await expect(
      getPrivateEvidenceUrl({ ...evidence, storageEncodingVersion: 0 }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("checks object size, type and digest metadata before signing and caps lifetime", async () => {
    mocks.send.mockResolvedValue({
      Metadata: { sha256: evidence.sha256 },
      ContentLength: 3,
      ContentType: "image/jpeg",
    });
    await expect(getPrivateEvidenceUrl(evidence, 3600)).resolves.toBe("signed-url");
    expect(mocks.sign).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), {
      expiresIn: 300,
    });
    for (const mismatch of [
      { Metadata: { sha256: "wrong" } },
      { ContentLength: 4 },
      { ContentType: "image/png" },
    ]) {
      mocks.sign.mockClear();
      mocks.send.mockResolvedValue({
        Metadata: { sha256: evidence.sha256 },
        ContentLength: 3,
        ContentType: "image/jpeg",
        ...mismatch,
      });
      await expect(getPrivateEvidenceUrl(evidence)).rejects.toMatchObject({ status: 404 });
      expect(mocks.sign).not.toHaveBeenCalled();
    }
  });
  it("checks actual bytes before recognition/optimization consumes them", async () => {
    mocks.send.mockResolvedValue({
      Body: {
        transformToWebStream: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 4]));
              controller.close();
            },
          }),
      },
      ContentLength: 3,
      ContentType: "image/jpeg",
      Metadata: { sha256: evidence.sha256 },
    });
    await expect(readVerifiedEvidence(evidence)).rejects.toMatchObject({ status: 404 });
  });
  it("checks storage metadata before recognition/optimization consumes matching bytes", async () => {
    mocks.send.mockResolvedValue({
      Body: {
        transformToWebStream: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
      },
      ContentLength: 3,
      ContentType: "image/jpeg",
      Metadata: { sha256: "wrong" },
    });
    await expect(readVerifiedEvidence(evidence)).rejects.toMatchObject({ status: 404 });
  });
});
