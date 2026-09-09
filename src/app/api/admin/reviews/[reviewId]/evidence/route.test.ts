// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  getEvidence: vi.fn(),
  readEvidence: vi.fn(),
}));

vi.mock("@/server/admin-guard", () => ({ getAdmin: mocks.getAdmin }));
vi.mock("@/server/admin-repository", () => ({
  getAdminReviewEvidence: mocks.getEvidence,
}));
vi.mock("@/server/storage", () => ({ readVerifiedEvidence: mocks.readEvidence }));

import { GET } from "@/app/api/admin/reviews/[reviewId]/evidence/route";

const context = { params: Promise.resolve({ reviewId: "review-1" }) };
const evidence = {
  objectKey: "evidence/review-1.jpg",
  mimeType: "image/jpeg",
  byteSize: 3,
  sha256: "a".repeat(64),
  storageEncodingVersion: 1,
  sanitizedAt: new Date("2026-09-08T00:00:00.000Z"),
};

describe("admin review evidence proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdmin.mockResolvedValue({
      id: "admin-1",
      permissions: ["reviews.read"],
      roles: ["REVIEWER"],
      unitId: "unit-1",
    });
    mocks.getEvidence.mockResolvedValue(evidence);
    mocks.readEvidence.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  it("authenticates and streams verified bytes from the same origin", async () => {
    const response = await GET(
      new NextRequest("http://crewqual.test/api/admin/reviews/review-1/evidence"),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(mocks.getAdmin).toHaveBeenCalledWith(expect.any(NextRequest), "reviews.read");
    expect(mocks.getEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-1" }),
      "review-1",
    );
    expect(mocks.readEvidence).toHaveBeenCalledWith(evidence);
  });

  it("returns not found without reading storage when the scoped review has no evidence", async () => {
    mocks.getEvidence.mockResolvedValue(null);
    const response = await GET(
      new NextRequest("http://crewqual.test/api/admin/reviews/review-1/evidence"),
      context,
    );

    expect(response.status).toBe(404);
    expect(mocks.readEvidence).not.toHaveBeenCalled();
  });
});
