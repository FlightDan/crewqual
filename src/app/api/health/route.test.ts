import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  queryRaw: vi.fn(),
  storageHealth: vi.fn(),
  heartbeat: vi.fn(),
  settingsReadAccess: vi.fn(),
}));

vi.mock("@/server/config", () => ({ getServerConfig: mocks.config }));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({
    $queryRaw: mocks.queryRaw,
    workerHeartbeat: { findUnique: mocks.heartbeat },
  }),
}));
vi.mock("@/server/health", () => ({ checkObjectStorage: mocks.storageHealth }));
vi.mock("@/server/admin-guard", () => ({
  hasSettingsReadAccess: mocks.settingsReadAccess,
}));

import { GET } from "@/app/api/health/route";

function request(path = "/api/health", headers: Record<string, string> = {}) {
  return new NextRequest(`http://crewqual.test${path}`, {
    headers: { "x-request-id": "health-request", ...headers },
  });
}

const readinessSecret = "readiness-probe-test-secret-0123456789";
function internalRequest(path = "/api/health?probe=readiness") {
  return request(path, { "x-crewqual-readiness-secret": readinessSecret });
}

describe("health endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("READINESS_PROBE_SECRET", readinessSecret);
    mocks.storageHealth.mockResolvedValue("ok");
    mocks.heartbeat.mockResolvedValue({ lastSeenAt: new Date() });
    mocks.settingsReadAccess.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("short-circuits liveness before configuration, authentication, or dependencies", async () => {
    mocks.config.mockImplementation(() => {
      throw new Error("configuration must not be read");
    });
    mocks.settingsReadAccess.mockRejectedValue(new Error("authentication must not run"));
    mocks.queryRaw.mockRejectedValue(new Error("database must not be queried"));
    mocks.storageHealth.mockRejectedValue(new Error("storage must not be queried"));

    const response = await GET(request("/api/health?probe=liveness"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: { status: "ok", probe: "liveness" },
      requestId: "health-request",
    });
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.settingsReadAccess).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.storageHealth).not.toHaveBeenCalled();
  });

  it("rejects proxied anonymous explicit readiness before dependency checks", async () => {
    mocks.config.mockImplementation(() => {
      throw new Error("configuration must not be read");
    });

    const response = await GET(
      request("/api/health?probe=readiness", { "x-forwarded-for": "198.51.100.10" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHENTICATED", requestId: "health-request" },
    });
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.settingsReadAccess).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.storageHealth).not.toHaveBeenCalled();
  });

  it("returns 403 for a proxied session without settings.read before dependency checks", async () => {
    mocks.config.mockImplementation(() => {
      throw new Error("configuration must not be read");
    });
    mocks.settingsReadAccess.mockResolvedValue(false);

    const response = await GET(
      request("/api/health?probe=readiness", {
        "x-forwarded-for": "198.51.100.10",
        cookie: "crewqual_admin_session=present",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN", requestId: "health-request" },
    });
    expect(mocks.settingsReadAccess).toHaveBeenCalledOnce();
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.storageHealth).not.toHaveBeenCalled();
  });

  it("allows a proxied settings reader to receive full readiness details", async () => {
    mocks.settingsReadAccess.mockResolvedValue(true);
    mocks.config.mockReturnValue({ SERVICE_MODE: "remote" });
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ table_name: "pgboss.job" }]);

    const response = await GET(
      request("/api/health?probe=readiness", {
        "x-forwarded-for": "198.51.100.10",
        cookie: "crewqual_admin_session=present",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "ok", probe: "readiness", database: "ok", storage: "ok", queue: "ok" },
    });
    expect(mocks.settingsReadAccess).toHaveBeenCalledOnce();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.storageHealth).toHaveBeenCalledOnce();
    expect(mocks.heartbeat).toHaveBeenCalledOnce();
  });

  it("keeps the bare public path compatible by returning liveness without dependencies", async () => {
    mocks.config.mockImplementation(() => {
      throw new Error("configuration must not be read");
    });

    const response = await GET(request("/api/health", { "x-forwarded-for": "198.51.100.10" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { status: "ok", probe: "liveness" },
      requestId: "health-request",
    });
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.storageHealth).not.toHaveBeenCalled();
  });

  it("reports mock dependencies as intentionally unused", async () => {
    mocks.config.mockReturnValue({ SERVICE_MODE: "mock" });

    const response = await GET(internalRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      data: {
        status: "ok",
        probe: "readiness",
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
    const healthy = await GET(internalRequest());
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({
      data: { status: "ok", mode: "remote", database: "ok", storage: "ok", queue: "ok" },
    });

    mocks.queryRaw.mockReset();
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const degraded = await GET(internalRequest());
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

    const response = await GET(internalRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "degraded", database: "ok", queue: "ok", worker: "unavailable" },
    });
  });

  it("returns a request-correlated 503 when dependencies throw", async () => {
    mocks.config.mockReturnValue({ SERVICE_MODE: "remote" });
    mocks.queryRaw.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(internalRequest());

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

  it("returns 503 within the readiness deadline when a dependency hangs", async () => {
    vi.useFakeTimers();
    mocks.config.mockReturnValue({ SERVICE_MODE: "remote" });
    mocks.queryRaw.mockImplementation(() => new Promise(() => undefined));

    const pendingResponse = GET(internalRequest());
    await vi.advanceTimersByTimeAsync(4_000);
    const response = await pendingResponse;

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "HEALTHCHECK_FAILED", requestId: "health-request" },
    });
  });

  it("reports object storage outage as degraded instead of configured", async () => {
    mocks.config.mockReturnValue({ SERVICE_MODE: "remote" });
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ table_name: "pgboss.job" }]);
    mocks.storageHealth.mockResolvedValue("unavailable");

    const response = await GET(internalRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "degraded", database: "ok", storage: "unavailable", queue: "ok" },
    });
  });
});
