import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authenticatePilot: vi.fn(),
  assertCsrf: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  authenticatePilot: mocks.authenticatePilot,
  assertCsrf: mocks.assertCsrf,
}));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({
    notificationDelivery: {
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
  }),
}));

import { GET, PATCH } from "@/app/api/pilot/notifications/[id]/route";

const context = { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000020" }) };

describe("pilot notification scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticatePilot.mockResolvedValue({ id: "pilot-1", csrfToken: "csrf-hash" });
  });

  it("returns 404 instead of exposing another pilot's notification", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await GET(
      new NextRequest("http://localhost/api/pilot/notifications/x"),
      context,
    );
    expect(response.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ pilotId: "pilot-1", channel: "IN_APP" }),
      }),
    );
  });

  it("marks read only through a pilot-scoped conditional update", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const response = await PATCH(
      new NextRequest("http://localhost:3000/api/pilot/notifications/x", {
        method: "PATCH",
        headers: { origin: "http://localhost:3000", "x-csrf-token": "csrf" },
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: expect.any(String), pilotId: "pilot-1" }),
        data: { readAt: expect.any(Date) },
      }),
    );
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ id: expect.any(String), readAt: expect.any(String) }),
      }),
    );
  });
});
