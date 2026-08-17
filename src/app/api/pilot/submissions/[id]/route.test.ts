import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authenticatePilot: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/server/auth", () => ({ authenticatePilot: mocks.authenticatePilot }));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({ qualificationUpdateRequest: { findFirst: mocks.findFirst } }),
}));

import { GET } from "@/app/api/pilot/submissions/[id]/route";

function request() {
  return new NextRequest("http://crewqual.test/api/pilot/submissions/request-1", {
    headers: { "x-request-id": "submission-request" },
  });
}

describe("pilot submission detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticatePilot.mockResolvedValue({ id: "pilot-1" });
  });

  it.each([
    ["PENDING", "processing"],
    ["APPROVED", "approved"],
    ["RETURNED", "returned"],
  ] as const)("exposes the durable %s status as %s", async (status, expectedStatus) => {
    mocks.findFirst.mockResolvedValue({
      id: "request-1",
      pilotId: "pilot-1",
      submittedAt: new Date("2026-08-15T08:00:00.000Z"),
      status,
      decisionNote: status === "APPROVED" ? "人工审核通过" : null,
      returnReason: status === "RETURNED" ? "请补充清晰凭证" : null,
      qualificationType: { code: "medical", name: "体检合格证" },
    });

    const response = await GET(request(), { params: Promise.resolve({ id: "request-1" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: "request-1",
        status: expectedStatus,
        ...(status === "APPROVED" ? { decisionNote: "人工审核通过" } : {}),
        ...(status === "RETURNED" ? { returnReason: "请补充清晰凭证" } : {}),
      },
      requestId: "submission-request",
    });
  });

  it("does not expose a submission owned by another pilot", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const response = await GET(request(), { params: Promise.resolve({ id: "other-request" }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND", requestId: "submission-request" },
    });
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "other-request", pilotId: "pilot-1" } }),
    );
  });
});
