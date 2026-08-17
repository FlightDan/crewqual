import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  queryRaw: vi.fn(),
  storageHealth: vi.fn(),
  heartbeat: vi.fn(),
}));

vi.mock("@/server/config", () => ({ getServerConfig: mocks.config }));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({
    $queryRaw: mocks.queryRaw,
    workerHeartbeat: { findUnique: mocks.heartbeat },
  }),
}));
vi.mock("@/server/health", () => ({ checkObjectStorage: mocks.storageHealth }));

import { GET } from "@/app/api/health/route";

function request() {
  return new NextRequest("http://crewqual.test/api/health", {
    headers: { "x-request-id": "health-request" },
  });
}

describe("health endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storageHealth.mockResolvedValue("ok");
    mocks.heartbeat.mockResolvedValue({ lastSeenAt: new Date() });
  });

  it("reports mock dependencies as intentionally unused", async () => {
    mocks.config.mockReturnValue({ SERVICE_MODE: "mock" });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      data: {
        status: "ok",
        mode: "mock",
        database: "not_used",
        storage: "not_used",
        queue: "not_used",
        instanceId: expect.any(String),
      },
      requestId: "health-request",
    });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("distinguishes healthy and degraded remote queue state", async () => {
    mocks.config.mockReturnValue({
      SERVICE_MODE: "remote",
      S3_ACCESS_KEY_ID: "access",
      S3_SECRET_ACCESS_KEY: "secret",
    });
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ table_name: "pgboss.job" }]);
    const healthy = await GET(request());
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({
      data: { status: "ok", mode: "remote", database: "ok", storage: "ok", queue: "ok" },
    });

    mocks.queryRaw.mockReset();
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const degraded = await GET(request());
    expect(degraded.status).toBe(503);
    expect(await degraded.json()).toMatchObject({
      data: { status: "degraded", database: "ok", queue: "unavailable" },
      requestId: "health-request",
    });
  });

  it("reports a stale worker heartbeat even when DB and pg-boss tables exist", async () => {
    mocks.config.mockReturnValue({ SERVICE_MODE: "remote" });
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ table_name: "pgboss.job" }]);
    mocks.heartbeat.mockResolvedValue({ lastSeenAt: new Date(Date.now() - 60_000) });

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "degraded", database: "ok", queue: "ok", worker: "unavailable" },
    });
  });

  it("returns a request-correlated 503 when dependencies throw", async () => {
    mocks.config.mockReturnValue({ SERVICE_MODE: "remote" });
    mocks.queryRaw.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toBe("health-request");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HEALTHCHECK_FAILED",
        message: "依赖检查失败",
        requestId: "health-request",
      },
    });
  });

  it("reports object storage outage as degraded instead of configured", async () => {
    mocks.config.mockReturnValue({ SERVICE_MODE: "remote" });
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ table_name: "pgboss.job" }]);
    mocks.storageHealth.mockResolvedValue("unavailable");

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "degraded", database: "ok", storage: "unavailable", queue: "ok" },
    });
  });
});
