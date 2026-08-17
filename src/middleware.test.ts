import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

function request(pathname: string) {
  return new NextRequest(`http://crewqual.test${pathname}`);
}

describe("service-mode middleware isolation", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SERVICE_MODE", "mock");
    delete process.env.SERVICE_MODE;
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns 404 for every non-health API in mock mode", () => {
    expect(middleware(request("/api/admin/dashboard")).status).toBe(404);
    expect(middleware(request("/api/dev/pilot-access")).status).toBe(404);
  });

  it("keeps the mock health endpoint and mock pages available", () => {
    expect(middleware(request("/api/health")).status).toBe(200);
    expect(middleware(request("/admin/dashboard")).status).toBe(200);
  });

  it("does not alter remote API routing", () => {
    vi.stubEnv("SERVICE_MODE", "remote");
    vi.stubEnv("NEXT_PUBLIC_SERVICE_MODE", "remote");
    expect(middleware(request("/api/admin/dashboard")).status).toBe(200);
  });
});
