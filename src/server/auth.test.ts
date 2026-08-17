import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const tx = {
    pilotAccessToken: { findUnique: vi.fn(), updateMany: vi.fn() },
    pilotSession: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  return {
    tx,
    db: { $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)) },
  };
});

vi.mock("@/server/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("@/server/config", () => ({
  getServerConfig: () => ({ PILOT_SESSION_TTL_MINUTES: 60, ADMIN_SESSION_TTL_HOURS: 8 }),
}));

import { assertCsrf, consumePilotAccessToken, requirePermission } from "@/server/auth";

function accessToken(overrides: Record<string, unknown> = {}) {
  return {
    id: "token-1",
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    pilot: { id: "pilot-1" },
    ...overrides,
  };
}

describe("Pilot one-time access token exchange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.auditEvent.create.mockResolvedValue({});
    mocks.tx.pilotSession.create.mockResolvedValue({ id: "session-1" });
  });

  it("claims the link and creates the 60 minute session inside one transaction", async () => {
    mocks.tx.pilotAccessToken.findUnique.mockResolvedValue(accessToken());
    mocks.tx.pilotAccessToken.updateMany.mockResolvedValue({ count: 1 });

    const result = await consumePilotAccessToken("a".repeat(32), "request-1");

    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.pilotAccessToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ consumedAt: null }) }),
    );
    expect(mocks.tx.pilotSession.create).toHaveBeenCalledTimes(1);
    expect(result.expiresAt.getTime() - Date.now()).toBeGreaterThan(59 * 60_000);
  });

  it.each([
    ["ACCESS_TOKEN_USED", accessToken({ consumedAt: new Date() })],
    ["ACCESS_TOKEN_EXPIRED", accessToken({ expiresAt: new Date(Date.now() - 1_000) })],
  ])("returns a specific %s state without creating a session", async (code, token) => {
    mocks.tx.pilotAccessToken.findUnique.mockResolvedValue(token);

    await expect(consumePilotAccessToken("b".repeat(32), "request-2")).rejects.toMatchObject({
      code,
    });
    expect(mocks.tx.pilotSession.create).not.toHaveBeenCalled();
  });

  it("rejects a concurrent replay when the conditional claim loses", async () => {
    mocks.tx.pilotAccessToken.findUnique.mockResolvedValue(accessToken());
    mocks.tx.pilotAccessToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(consumePilotAccessToken("c".repeat(32), "request-3")).rejects.toMatchObject({
      code: "ACCESS_TOKEN_USED",
    });
    expect(mocks.tx.pilotSession.create).not.toHaveBeenCalled();
    expect(mocks.tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ detail: { concurrent: true } }) }),
    );
  });
});

describe("authentication request boundaries", () => {
  it("requires a matching CSRF token and enforces operation permissions", async () => {
    const csrfToken = "csrf-token";
    const csrfHash = createHash("sha256").update(csrfToken).digest("hex");
    const validRequest = new NextRequest("http://crewqual.test/api/admin/example", {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
    });
    await expect(assertCsrf(validRequest, csrfHash)).resolves.toBeUndefined();

    const missingTokenRequest = new NextRequest("http://crewqual.test/api/admin/example", {
      method: "POST",
    });
    await expect(assertCsrf(missingTokenRequest, csrfHash)).rejects.toMatchObject({
      code: "CSRF_FAILED",
      status: 403,
    });

    const viewer = {
      id: "admin-1",
      email: "viewer@example.test",
      displayName: "Viewer",
      roles: ["VIEWER"],
      permissions: ["dashboard.read"],
      unitId: "unit-1",
      unitName: "测试单位",
      sessionId: "session-1",
      csrfToken,
      expiresAt: new Date(Date.now() + 60_000),
    };
    expect(() => requirePermission(viewer, "reviews.decide")).toThrow("没有执行此操作的权限");
    expect(() => requirePermission(viewer, "dashboard.read")).not.toThrow();
  });
});
