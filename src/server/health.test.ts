import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => ({
  HeadBucketCommand: class {
    constructor(public readonly input: unknown) {}
  },
  S3Client: class {
    send = mocks.send;
  },
}));

import { checkObjectStorage } from "@/server/health";

const config = {
  S3_ENDPOINT: "http://127.0.0.1:59000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "crewqual-private",
  S3_ACCESS_KEY_ID: "crewqual",
  S3_SECRET_ACCESS_KEY: "secret",
  S3_FORCE_PATH_STYLE: true,
} as const;

describe("object storage health check", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not attempt a network call when credentials are absent", async () => {
    await expect(
      checkObjectStorage({ ...config, S3_ACCESS_KEY_ID: "", S3_SECRET_ACCESS_KEY: "" }),
    ).resolves.toBe("unconfigured");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("checks the configured bucket", async () => {
    mocks.send.mockResolvedValue({});

    await expect(checkObjectStorage(config)).resolves.toBe("ok");
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0]?.[0].input).toEqual({ Bucket: "crewqual-private" });
    expect(mocks.send.mock.calls[0]?.[1]?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("returns unavailable when the bucket probe fails", async () => {
    mocks.send.mockRejectedValue(new Error("minio unavailable"));

    await expect(checkObjectStorage(config)).resolves.toBe("unavailable");
  });
});
