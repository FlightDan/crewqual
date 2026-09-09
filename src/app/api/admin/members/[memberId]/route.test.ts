import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  getMember: vi.fn(),
}));

vi.mock("@/server/admin-guard", () => ({ getAdmin: mocks.getAdmin }));
vi.mock("@/server/member-repository", () => ({ getMember: mocks.getMember }));

import { GET } from "@/app/api/admin/members/[memberId]/route";

const validMemberId = "00000000-0000-4000-8000-000000000001";

describe("admin member detail route input contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdmin.mockResolvedValue({ id: "admin-1" });
    mocks.getMember.mockResolvedValue({ id: validMemberId });
  });

  it("returns a validation error before querying for a malformed member ID", async () => {
    const response = await GET(new NextRequest("http://crewqual.test/api/admin/members/PILOT"), {
      params: Promise.resolve({ memberId: "PILOT" }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR", message: "请求参数不合法" },
    });
    expect(mocks.getMember).not.toHaveBeenCalled();
  });

  it("passes valid UUIDs to the scoped member repository", async () => {
    const response = await GET(
      new NextRequest(`http://crewqual.test/api/admin/members/${validMemberId}`),
      { params: Promise.resolve({ memberId: validMemberId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.getMember).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-1" }),
      validMemberId,
    );
  });
});
