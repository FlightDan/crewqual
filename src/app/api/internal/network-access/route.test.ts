import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  config: {
    NETWORK_ACCESS_SECRET: "test-only-network-secret-not-a-real-credential",
    DEPLOYMENT_NETWORK_MODE: "public",
  },
  policy: vi.fn(),
  signal: vi.fn(),
  gap: vi.fn(),
}));
vi.mock("@/server/config", () => ({ getServerConfig: () => mocks.config }));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({ securityPolicy: { findUnique: mocks.policy } }),
}));
vi.mock("@/server/security-events", () => ({
  recordSecuritySignal: mocks.signal,
  recordSecurityCollectionGap: mocks.gap,
}));
vi.mock("@/server/rate-limit", () => ({ requestAddress: () => "203.0.113.20" }));

import { GET } from "@/app/api/internal/network-access/route";
import { verifyPublicRequestKey } from "@/server/security-request";
import { classifySecurityRoute } from "@/server/security-route-classifier";

const key = "00000000-0000-4000-8000-000000000001";
function request(overrides: Record<string, string> = {}) {
  return new NextRequest("http://crewqual.test/api/internal/network-access", {
    headers: {
      "x-crewqual-network-secret": mocks.config.NETWORK_ACCESS_SECRET,
      "x-crewqual-request-key": key,
      "x-crewqual-original-method": "GET",
      "x-crewqual-original-path": "/api/member/qualifications",
      "x-crewqual-remote-ip": "203.0.113.20",
      "x-crewqual-route-class": "CALLER_FORGED_CLASS",
      authorization: "Bearer synthetic-unused-value",
      cookie: "synthetic-unused-cookie=value",
      ...overrides,
    },
  });
}

describe("authenticated public ingress preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.DEPLOYMENT_NETWORK_MODE = "public";
    mocks.policy.mockResolvedValue({ allowPublicAccess: true });
    mocks.signal.mockResolvedValue("recorded");
    mocks.gap.mockResolvedValue(undefined);
  });

  it.each(["", "wrong-test-secret", "x".repeat(mocks.config.NETWORK_ACCESS_SECRET.length)])(
    "rejects an unauthenticated preflight without creating attacker-controlled telemetry",
    async (secret) => {
      const response = await GET(request({ "x-crewqual-network-secret": secret }));
      expect(response.status).toBe(404);
      expect(mocks.policy).not.toHaveBeenCalled();
      expect(mocks.signal).not.toHaveBeenCalled();
      expect(mocks.gap).not.toHaveBeenCalled();
    },
  );

  it("copies only the sealed request key and server-classified route into an allowed response", async () => {
    const response = await GET(request());
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    const routeClass = classifySecurityRoute("/api/member/qualifications", "GET").routeClass;
    const sealed = response.headers.get("x-crewqual-request-key")!;
    expect(sealed).not.toBe(key);
    expect(verifyPublicRequestKey(sealed, routeClass, "GET", "/api/member/qualifications")).toBe(
      true,
    );
    expect(Object.fromEntries(response.headers.entries())).toEqual({
      "cache-control": "no-store",
      "x-crewqual-request-key": sealed,
      "x-crewqual-route-class": routeClass,
    });
    expect(mocks.signal).not.toHaveBeenCalled();
    expect(mocks.gap).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([
    { "x-crewqual-request-key": "not-a-uuid" },
    { "x-crewqual-original-method": "" },
    { "x-crewqual-original-method": "GET POST" },
    { "x-crewqual-original-path": "relative/path" },
    { "x-crewqual-original-path": "/member?token=synthetic" },
    { "x-crewqual-original-path": "/member#fragment" },
    { "x-crewqual-original-path": `/${"x".repeat(2_048)}` },
  ])("records a collection gap for invalid authenticated context", async (headers) => {
    const response = await GET(request(headers));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NETWORK_ACCESS_CHECK_FAILED" },
    });
    expect(mocks.gap).toHaveBeenCalledExactlyOnceWith("PREFLIGHT_FAILED");
    expect(mocks.policy).not.toHaveBeenCalled();
    expect(mocks.signal).not.toHaveBeenCalled();
    expect(response.headers.has("x-crewqual-request-key")).toBe(false);
  });

  it.each([
    ["/.env", "GET", "KNOWN_PROBE", "KNOWN_PROBE"],
    ["/api/not-registered", "GET", "UNKNOWN_ROUTE", "UNKNOWN_API"],
    ["/api/member/qualifications", "POST", "INVALID_METHOD", "INVALID_METHOD"],
  ])("records %s %s once during preflight", async (pathname, method, kind, outcome) => {
    const response = await GET(
      request({ "x-crewqual-original-path": pathname, "x-crewqual-original-method": method }),
    );
    expect(response.status).toBe(204);
    expect(mocks.signal).toHaveBeenCalledTimes(1);
    expect(mocks.signal).toHaveBeenCalledWith(
      {
        requestKey: response.headers.get("x-crewqual-request-key"),
        kind,
        pathname,
        outcome,
        address: "203.0.113.20",
        routeClass: classifySecurityRoute(pathname, method).routeClass,
      },
      expect.objectContaining({ securityPolicy: { findUnique: mocks.policy } }),
    );
  });

  it("denies public access by policy, records the denial and copies no ingress seal", async () => {
    mocks.policy.mockResolvedValue({ allowPublicAccess: false });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(Object.fromEntries(response.headers.entries())).toEqual({ "cache-control": "no-store" });
    expect(mocks.signal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "PUBLIC_ACCESS_DENIED",
        outcome: "KNOWN_ROUTE_PUBLIC_DENIED",
      }),
      expect.anything(),
    );
  });

  it("keeps the probe classification when policy also denies access", async () => {
    mocks.policy.mockResolvedValue({ allowPublicAccess: false });
    expect((await GET(request({ "x-crewqual-original-path": "/.env" }))).status).toBe(403);
    expect(mocks.signal).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "KNOWN_PROBE", outcome: "KNOWN_PROBE_PUBLIC_DENIED" }),
      expect.anything(),
    );
  });

  it("defaults a missing database policy to the deployment's network mode", async () => {
    mocks.policy.mockResolvedValue(null);
    mocks.config.DEPLOYMENT_NETWORK_MODE = "lan";
    expect((await GET(request())).status).toBe(403);
    mocks.config.DEPLOYMENT_NETWORK_MODE = "public";
    expect((await GET(request())).status).toBe(204);
  });

  it("fails closed and reports a gap when policy lookup or event collection fails", async () => {
    mocks.policy.mockRejectedValueOnce(new Error("synthetic database failure"));
    expect((await GET(request())).status).toBe(503);
    expect(mocks.gap).toHaveBeenCalledWith("PREFLIGHT_FAILED");
    mocks.signal.mockRejectedValueOnce(new Error("synthetic event failure"));
    mocks.gap.mockRejectedValueOnce(new Error("synthetic gap failure"));
    expect((await GET(request({ "x-crewqual-original-path": "/.env" }))).status).toBe(503);
  });
});
