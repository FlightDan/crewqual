import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getPrisma } = vi.hoisted(() => ({ getPrisma: vi.fn() }));
vi.mock("@/server/prisma", () => ({ getPrisma }));

import { GET } from "@/app/api/dev/pilot-access/route";
import { resetServerConfigForTests } from "@/server/config";

describe("development pilot access bridge", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SERVICE_MODE", "mock");
    vi.stubEnv("NEXT_PUBLIC_SERVICE_MODE", "mock");
    vi.stubEnv("SESSION_SECRET", "pilot-access-test-session-secret-0123456789abcdef");
    vi.stubEnv("DEV_ENDPOINTS", "false");
    vi.stubEnv("DEV_ENDPOINTS_SECRET", "");
    getPrisma.mockReset();
    resetServerConfigForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetServerConfigForTests();
  });

  it("is unavailable in mock mode before touching Prisma", async () => {
    const response = await GET(
      new NextRequest("http://crewqual.test/api/dev/pilot-access?employeeNumber=CQ-1"),
    );

    expect(response.status).toBe(404);
    expect(getPrisma).not.toHaveBeenCalled();
  });

  it("stays 404 in remote mode unless DEV_ENDPOINTS is explicitly enabled", async () => {
    vi.stubEnv("SERVICE_MODE", "remote");
    resetServerConfigForTests();

    const response = await GET(
      new NextRequest("http://crewqual.test/api/dev/pilot-access?employeeNumber=CQ-1"),
    );

    expect(response.status).toBe(404);
    expect(getPrisma).not.toHaveBeenCalled();
  });

  it("mints a single-use access token when explicitly opted in", async () => {
    vi.stubEnv("SERVICE_MODE", "remote");
    vi.stubEnv("SESSION_SECRET", "pilot-access-test-session-secret-0123456789abcdef");
    vi.stubEnv("DEV_ENDPOINTS", "true");
    vi.stubEnv("DEV_ENDPOINTS_SECRET", "pilot-access-dev-endpoint-secret-0123456789");
    resetServerConfigForTests();
    const tx = {
      pilotAccessToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), create: vi.fn() },
    };
    getPrisma.mockReturnValue({
      pilot: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "pilot-1", employeeNumber: "CQ-1", active: true }),
      },
      $transaction: vi.fn(async (run: (tx: unknown) => Promise<void>) => run(tx)),
    });

    const response = await GET(
      new NextRequest("http://crewqual.test/api/dev/pilot-access?employeeNumber=CQ-1", {
        headers: { "x-crewqual-dev-secret": "pilot-access-dev-endpoint-secret-0123456789" },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data?: { accessUrl?: string; token?: string } };
    expect(body.data?.accessUrl).toContain("/pilot/access/");
    expect(body.data?.token).toBeTruthy();
    expect(tx.pilotAccessToken.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pilotId: "pilot-1" }) }),
    );
  });

  it("stays hidden when the remote dev endpoint secret is missing", async () => {
    vi.stubEnv("SERVICE_MODE", "remote");
    vi.stubEnv("DEV_ENDPOINTS", "true");
    vi.stubEnv("DEV_ENDPOINTS_SECRET", "pilot-access-dev-endpoint-secret-0123456789");
    resetServerConfigForTests();

    const response = await GET(
      new NextRequest("http://crewqual.test/api/dev/pilot-access?employeeNumber=CQ-1"),
    );

    expect(response.status).toBe(404);
    expect(getPrisma).not.toHaveBeenCalled();
  });
});
