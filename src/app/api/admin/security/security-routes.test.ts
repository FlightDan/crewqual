import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  querySummary: vi.fn(),
  queryDetections: vi.fn(),
  findSession: vi.fn(),
  findState: vi.fn(),
}));

vi.mock("@/server/admin-guard", () => ({ getAdmin: mocks.getAdmin }));
vi.mock("@/server/security-detection", () => ({ querySecuritySummary: mocks.querySummary }));
vi.mock("@/server/security-query", async (loadOriginal) => ({
  ...(await loadOriginal<typeof import("@/server/security-query")>()),
  querySecurityDetections: mocks.queryDetections,
}));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({
    adminSession: { findFirst: mocks.findSession },
    securityTelemetryState: { findUnique: mocks.findState },
  }),
}));

import { GET as summary } from "@/app/api/admin/security/summary/route";
import { GET as trends } from "@/app/api/admin/security/trends/route";
import { GET as detections } from "@/app/api/admin/security/detections/route";

const admin = {
  id: "admin-id",
  sessionId: "session-id",
  roles: ["ADMIN"],
  unitId: "unit-id",
};

describe("administrator security telemetry routes", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.getAdmin.mockResolvedValue(admin);
    mocks.findSession.mockResolvedValue({
      createdAt: new Date("2026-09-08T10:00:00Z"),
      securitySummarySince: new Date("2026-09-07T08:00:00Z"),
      securitySummaryUntil: new Date("2026-09-08T08:00:00Z"),
    });
    mocks.querySummary.mockResolvedValue({ batches: 3, requests: 17, complete: true });
    mocks.queryDetections.mockResolvedValue({ items: [], total: 0 });
  });

  it("uses only the current session's fixed login-summary interval", async () => {
    const response = await summary(
      new NextRequest("http://crewqual.test/api/admin/security/summary?since=1970-01-01"),
    );
    expect(response.status).toBe(200);
    expect(mocks.getAdmin).toHaveBeenCalledWith(expect.any(NextRequest), "audit.read");
    expect(mocks.findSession).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "session-id", userId: "admin-id" } }),
    );
    expect(mocks.querySummary).toHaveBeenCalledWith(
      new Date("2026-09-07T08:00:00Z"),
      new Date("2026-09-08T08:00:00Z"),
      expect.any(Object),
    );
    expect((await response.json()).data).toMatchObject({
      sessionId: "session-id",
      batches: 3,
      requests: 17,
      complete: true,
    });
  });

  it("marks additive-migration sessions unavailable instead of inventing history", async () => {
    mocks.findSession.mockResolvedValue({
      createdAt: new Date("2026-09-08T10:00:21Z"),
      securitySummarySince: null,
      securitySummaryUntil: null,
    });
    mocks.findState.mockResolvedValue({
      collectionHealthy: true,
      processedThrough: new Date("2026-09-08T10:00:00Z"),
      lastCollectedAt: new Date("2026-09-08T10:00:00Z"),
      lastAggregatedAt: new Date("2026-09-08T10:01:00Z"),
      droppedCount: 0,
    });
    const response = await summary(
      new NextRequest("http://crewqual.test/api/admin/security/summary"),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.querySummary).not.toHaveBeenCalled();
    expect(body.data).toMatchObject({
      sessionId: "session-id",
      since: "2026-09-08T10:00:00.000Z",
      until: "2026-09-08T10:00:00.000Z",
      complete: false,
      lastError: "SESSION_INTERVAL_UNAVAILABLE",
    });
  });

  it("allows only the three fixed trend ranges and floors the server boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:34:56Z"));
    const response = await trends(
      new NextRequest("http://crewqual.test/api/admin/security/trends?range=7d"),
    );
    expect(response.status).toBe(200);
    expect(mocks.querySummary).toHaveBeenCalledWith(
      new Date("2026-09-01T12:34:00Z"),
      new Date("2026-09-08T12:34:00Z"),
      expect.any(Object),
    );
    const rejected = await trends(
      new NextRequest("http://crewqual.test/api/admin/security/trends?range=7d&since=1970-01-01"),
    );
    expect(rejected.status).toBe(422);
  });

  it("passes role and unit context to the bounded detection query", async () => {
    const response = await detections(
      new NextRequest(
        "http://crewqual.test/api/admin/security/detections?range=30d&page=2&pageSize=10",
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.queryDetections).toHaveBeenCalledWith(
      { range: "30d", page: 2, pageSize: 10, admin },
      expect.any(Object),
    );
    expect(mocks.getAdmin).toHaveBeenCalledWith(expect.any(NextRequest), "audit.read");
  });
});
