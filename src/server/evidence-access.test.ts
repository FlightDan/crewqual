// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  audit: vi.fn(),
  sign: vi.fn(),
  transaction: vi.fn(),
  runtime: vi.fn(),
}));
vi.mock("@/server/auth", () => ({
  authenticatePilot: async () => ({ id: "pilot-1", personId: "person-1", csrfToken: "csrf" }),
  assertCsrf: async () => {},
}));
vi.mock("@/server/api", async (original) => ({
  ...(await original<typeof import("@/server/api")>()),
  assertSameOrigin: () => {},
}));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({
    evidenceImage: { findFirst: mocks.find },
    auditEvent: { create: mocks.audit },
    $transaction: mocks.transaction,
  }),
}));
vi.mock("@/server/storage", () => ({ getPrivateEvidenceUrl: mocks.sign }));
vi.mock("@/server/runtime-settings", () => ({
  getRuntimeIntegration: mocks.runtime,
}));
vi.mock("@/server/jobs", () => ({
  QUEUES: { recognition: "recognition" },
  enqueueInTransaction: vi.fn(),
}));
import { GET } from "@/app/api/evidence-images/[id]/url/route";
import { POST } from "@/app/api/evidence-images/[id]/recognitions/route";

const evidence = {
  id: "image-1",
  pilotId: "pilot-1",
  personId: "person-1",
  objectKey: "evidence/1.jpg",
  mimeType: "image/jpeg",
  byteSize: 3,
  sha256: "a".repeat(64),
  storageEncodingVersion: 1,
  sanitizedAt: new Date(),
};
const context = { params: Promise.resolve({ id: "image-1" }) };

describe("evidence endpoint provenance gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sign.mockResolvedValue("signed-url");
    mocks.runtime.mockResolvedValue({
      enabled: true,
      adapter: "qwen",
      retryLimit: 3,
      model: "test",
    });
  });
  it("returns the same 404 for absent and unproven evidence without signing, auditing reads or queueing", async () => {
    for (const row of [
      null,
      { ...evidence, storageEncodingVersion: 0 },
      { ...evidence, sanitizedAt: null },
    ]) {
      mocks.find.mockResolvedValue(row);
      expect(
        (await GET(new NextRequest("http://localhost/api/evidence-images/image-1/url"), context))
          .status,
      ).toBe(404);
      expect(
        (
          await POST(
            new NextRequest("http://localhost/api/evidence-images/image-1/recognitions", {
              method: "POST",
            }),
            context,
          )
        ).status,
      ).toBe(404);
    }
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("passes the full source descriptor to the signing gate after an owner-scoped lookup", async () => {
    mocks.find.mockResolvedValue(evidence);
    const response = await GET(
      new NextRequest("http://localhost/api/evidence-images/image-1/url"),
      context,
    );
    expect(response.status).toBe(200);
    expect(mocks.find).toHaveBeenCalledWith({
      where: {
        id: "image-1",
        pilotId: "pilot-1",
        OR: [{ personId: null }, { personId: "person-1" }],
      },
    });
    expect(mocks.sign).toHaveBeenCalledWith(evidence, 300);
  });

  it("returns a disabled state without creating a recognition task", async () => {
    mocks.find.mockResolvedValue(evidence);
    mocks.runtime.mockResolvedValue({
      enabled: false,
      adapter: "disabled",
      retryLimit: 0,
      model: "",
    });

    const response = await POST(
      new NextRequest("http://localhost/api/evidence-images/image-1/recognitions", {
        method: "POST",
      }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { status: "DISABLED" } });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
