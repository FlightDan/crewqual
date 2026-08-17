import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getPrisma } = vi.hoisted(() => ({ getPrisma: vi.fn() }));
vi.mock("@/server/prisma", () => ({ getPrisma }));

import { GET } from "@/app/api/dev/pilot-access/route";

describe("development pilot access bridge", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SERVICE_MODE", "mock");
    vi.stubEnv("NEXT_PUBLIC_SERVICE_MODE", "mock");
    getPrisma.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("is unavailable in mock mode before touching Prisma", async () => {
    const response = await GET(
      new NextRequest("http://crewqual.test/api/dev/pilot-access?employeeNumber=CQ-1"),
    );

    expect(response.status).toBe(404);
    expect(getPrisma).not.toHaveBeenCalled();
  });
});
