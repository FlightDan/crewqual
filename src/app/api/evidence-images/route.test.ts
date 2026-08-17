import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authenticatePilot: vi.fn(),
  validateProcessedJpeg: vi.fn(),
  putPrivateEvidence: vi.fn(),
  deletePrivateEvidence: vi.fn(),
  evidenceCreate: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  assertCsrf: vi.fn().mockResolvedValue(undefined),
  authenticatePilot: mocks.authenticatePilot,
}));
vi.mock("@/server/storage", () => ({
  deletePrivateEvidence: mocks.deletePrivateEvidence,
  putPrivateEvidence: mocks.putPrivateEvidence,
  validateProcessedJpeg: mocks.validateProcessedJpeg,
}));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({ evidenceImage: { create: mocks.evidenceCreate } }),
}));

import { POST } from "@/app/api/evidence-images/route";
import { resetServerConfigForTests } from "@/server/config";

function request(body?: BodyInit, contentType?: string) {
  return new NextRequest("http://127.0.0.1:3000/api/evidence-images", {
    method: "POST",
    headers: {
      origin: "http://127.0.0.1:3000",
      "x-request-id": "image-request",
      ...(contentType ? { "content-type": contentType } : {}),
    },
    body,
  });
}

describe("evidence image upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
    resetServerConfigForTests();
    mocks.authenticatePilot.mockResolvedValue({ id: "pilot-1", csrfToken: "csrf" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetServerConfigForTests();
  });

  it("returns a structured 422 when the multipart file is missing", async () => {
    const response = await POST(request());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_IMAGE", requestId: "image-request" },
    });
    expect(mocks.validateProcessedJpeg).not.toHaveBeenCalled();
    expect(mocks.putPrivateEvidence).not.toHaveBeenCalled();
    expect(mocks.evidenceCreate).not.toHaveBeenCalled();
  });

  it("rejects non-JPEG uploads before storage or database writes", async () => {
    const boundary = "----crewqual-test-boundary";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="evidence.png"',
      "Content-Type: image/png",
      "",
      "png",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const response = await POST(request(body, `multipart/form-data; boundary=${boundary}`));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_IMAGE", requestId: "image-request" },
    });
    expect(mocks.validateProcessedJpeg).not.toHaveBeenCalled();
    expect(mocks.putPrivateEvidence).not.toHaveBeenCalled();
    expect(mocks.evidenceCreate).not.toHaveBeenCalled();
  });
});
