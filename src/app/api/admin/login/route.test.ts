import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  verify: vi.fn(),
  dummyHash: vi.fn(),
  findUser: vi.fn(),
}));

vi.mock("@/server/rate-limit", () => ({
  consumeRateLimit: mocks.consume,
  requestAddress: () => "direct-client",
}));
vi.mock("@/server/auth", () => ({
  createAdminSession: vi.fn(),
  setSessionCookies: vi.fn(),
  verifyPassword: mocks.verify,
  dummyPasswordHash: mocks.dummyHash,
}));
vi.mock("@/server/crypto", () => ({ resolveTotpSecret: vi.fn(), verifyTotp: vi.fn() }));
vi.mock("@/server/runtime-settings", () => ({
  getRuntimeSecurityPolicy: () =>
    Promise.resolve({ requireTotp: true, maxFailedAttempts: 5, lockoutMinutes: 15 }),
}));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({ adminUser: { findUnique: mocks.findUser } }),
}));

import { POST } from "@/app/api/admin/login/route";

describe("admin login enumeration and rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consume.mockResolvedValue(true);
    mocks.findUser.mockResolvedValue(null);
    mocks.dummyHash.mockResolvedValue("argon-dummy-hash");
    mocks.verify.mockResolvedValue(false);
  });

  it("charges both address and normalized-account buckets and verifies a dummy hash", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: { origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({
          email: "Unknown@Example.Test",
          password: "not-the-password",
          totpCode: "000000",
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.consume).toHaveBeenCalledWith(
      "admin-login:address:direct-client",
      20,
      15 * 60 * 1000,
    );
    expect(mocks.consume).toHaveBeenCalledWith(
      "admin-login:account:unknown@example.test",
      10,
      15 * 60 * 1000,
    );
    expect(mocks.verify).toHaveBeenCalledWith("argon-dummy-hash", "not-the-password");
  });
});
