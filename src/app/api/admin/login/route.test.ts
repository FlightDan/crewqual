import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  verify: vi.fn(),
  verifyTotp: vi.fn(),
  resolveTotp: vi.fn(),
  dummyHash: vi.fn(),
  findUser: vi.fn(),
  updateUser: vi.fn(),
  updateMany: vi.fn(),
  createSession: vi.fn(),
  setCookies: vi.fn(),
  policy: { adminLoginMode: "PASSWORD_TOTP", maxFailedAttempts: 5, lockoutMinutes: 15 },
}));

vi.mock("@/server/rate-limit", () => ({
  consumeRateLimit: mocks.consume,
  requestAddress: () => "direct-client",
}));
vi.mock("@/server/auth", () => ({
  createAdminSession: mocks.createSession,
  setSessionCookies: mocks.setCookies,
  verifyPassword: mocks.verify,
  dummyPasswordHash: mocks.dummyHash,
}));
vi.mock("@/server/crypto", () => ({
  resolveTotpSecret: mocks.resolveTotp,
  verifyTotp: mocks.verifyTotp,
}));
vi.mock("@/server/runtime-settings", () => ({
  getRuntimeSecurityPolicy: () => Promise.resolve(mocks.policy),
}));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({
    adminUser: {
      findUnique: mocks.findUser,
      update: mocks.updateUser,
      updateMany: mocks.updateMany,
    },
    adminSession: { create: mocks.createSession },
    auditEvent: { create: vi.fn() },
  }),
}));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({}) }));

import { POST } from "@/app/api/admin/login/route";

describe("admin login enumeration and rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consume.mockResolvedValue(true);
    mocks.policy = { adminLoginMode: "PASSWORD_TOTP", maxFailedAttempts: 5, lockoutMinutes: 15 };
    mocks.findUser.mockResolvedValue(null);
    mocks.dummyHash.mockResolvedValue("argon-dummy-hash");
    mocks.verify.mockResolvedValue(false);
    mocks.resolveTotp.mockReturnValue("JBSWY3DPEHPK3PXP");
    mocks.verifyTotp.mockReturnValue(null);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.createSession.mockResolvedValue({
      id: "session-1",
      rawToken: "token",
      csrfToken: "csrf",
      expiresAt: new Date(Date.now() + 3600_000),
    });
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

  it.each([
    ["PASSWORD_TOTP", { password: "secret", totpCode: "123456" }],
    ["TOTP_ONLY", { totpCode: "123456" }],
    ["PASSWORD_ONLY", { password: "secret" }],
  ] as const)("authenticates with the %s credential set", async (adminLoginMode, credentials) => {
    mocks.policy = { adminLoginMode, maxFailedAttempts: 5, lockoutMinutes: 15 };
    mocks.findUser.mockResolvedValue({
      id: "admin-1",
      active: true,
      lockedUntil: null,
      failedAttempts: 0,
      passwordHash: "password-hash",
      totpSecretCiphertext: "encrypted-totp",
      totpVerifiedAt: null,
      lastTotpCounter: null,
    });
    mocks.verify.mockResolvedValue(true);
    mocks.verifyTotp.mockReturnValue(100);

    const response = await POST(
      new NextRequest("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: { origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", ...credentials }),
      }),
    );

    expect(response.status).toBe(200);
    if (adminLoginMode === "TOTP_ONLY") expect(mocks.verify).not.toHaveBeenCalled();
    if (adminLoginMode === "PASSWORD_ONLY") expect(mocks.verifyTotp).not.toHaveBeenCalled();
  });

  it("rejects a replayed TOTP counter atomically", async () => {
    mocks.policy = { adminLoginMode: "TOTP_ONLY", maxFailedAttempts: 5, lockoutMinutes: 15 };
    mocks.findUser.mockResolvedValue({
      id: "admin-1",
      active: true,
      lockedUntil: null,
      failedAttempts: 0,
      passwordHash: "password-hash",
      totpSecretCiphertext: "encrypted-totp",
      totpVerifiedAt: new Date(),
      lastTotpCounter: BigInt(100),
    });
    mocks.verifyTotp.mockReturnValue(100);
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: { origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", totpCode: "123456" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.updateMany).toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
