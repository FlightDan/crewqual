import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findPolicy: vi.fn(),
  findActor: vi.fn(),
  upsertPolicy: vi.fn(),
  deleteSessions: vi.fn(),
  updateActor: vi.fn(),
  createAudit: vi.fn(),
  transaction: vi.fn(),
  verifyPassword: vi.fn(),
  verifyTotp: vi.fn(),
  resolveTotp: vi.fn(),
  deleteCookie: vi.fn(),
}));

const tx = {
  securityPolicy: { upsert: mocks.upsertPolicy },
  adminSession: { deleteMany: mocks.deleteSessions },
  adminUser: { update: mocks.updateActor },
  auditEvent: { create: mocks.createAudit },
};

const db = {
  securityPolicy: { findUnique: mocks.findPolicy },
  adminUser: { findUniqueOrThrow: mocks.findActor },
  $transaction: mocks.transaction,
};

vi.mock("@/server/admin-guard", () => ({
  getAdmin: () =>
    Promise.resolve({
      id: "00000000-0000-4000-8000-000000000001",
      roles: ["SUPER_ADMIN"],
      permissions: ["settings.read", "settings.security.write"],
      unitId: null,
    }),
}));
vi.mock("@/server/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/server/auth", () => ({
  requirePermission: vi.fn(),
  verifyPassword: mocks.verifyPassword,
  hashPassword: vi.fn(),
  COOKIE_NAMES: { admin: "crewqual_admin_session" },
}));
vi.mock("@/server/crypto", () => ({
  createTotpSecret: vi.fn(),
  decryptSettingSecret: vi.fn(),
  encryptSettingSecret: vi.fn(),
  resolveTotpSecret: mocks.resolveTotp,
  verifyTotp: mocks.verifyTotp,
}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ delete: mocks.deleteCookie }),
}));

import { PATCH } from "@/app/api/admin/settings/route";

const currentPolicy = {
  id: "global",
  adminLoginMode: "PASSWORD_TOTP",
  adminSessionTtlHours: 8,
  pilotAccessLinkTtlMinutes: 15,
  pilotSessionTtlMinutes: 60,
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
  version: 1,
};

const actor = {
  passwordHash: "password-hash",
  totpSecretCiphertext: "encrypted-totp",
  totpVerifiedAt: null,
  lastTotpCounter: null,
};

function request(input: Record<string, unknown>) {
  return new NextRequest("http://crewqual.test/api/admin/settings", {
    method: "PATCH",
    headers: { origin: "http://crewqual.test", "content-type": "application/json" },
    body: JSON.stringify({ action: "security.save", input }),
  });
}

describe("security login mode changes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findPolicy.mockResolvedValue(currentPolicy);
    mocks.findActor.mockResolvedValue(actor);
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.upsertPolicy.mockImplementation((args) => ({
      ...currentPolicy,
      ...args.update,
      version: 2,
    }));
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.resolveTotp.mockReturnValue("JBSWY3DPEHPK3PXP");
    mocks.verifyTotp.mockReturnValue(100);
  });

  it("requires the target mode credentials and revokes every session", async () => {
    const response = await PATCH(
      request({
        ...currentPolicy,
        adminLoginMode: "TOTP_ONLY",
        currentTotpCode: "123456",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { reauthenticate: true, policy: { adminLoginMode: "TOTP_ONLY" } },
    });
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.deleteSessions).toHaveBeenCalledWith({});
    expect(mocks.updateActor).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastTotpCounter: BigInt(100) }) }),
    );
    expect(mocks.deleteCookie).toHaveBeenCalledWith("crewqual_admin_session");
    expect(mocks.deleteCookie).toHaveBeenCalledWith("crewqual_admin_session_csrf");
  });

  it("requires the current password when switching to password-only", async () => {
    const response = await PATCH(
      request({
        ...currentPolicy,
        adminLoginMode: "PASSWORD_ONLY",
        currentPassword: "current-password",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.verifyPassword).toHaveBeenCalledWith("password-hash", "current-password");
    expect(mocks.verifyTotp).not.toHaveBeenCalled();
    expect(mocks.deleteSessions).toHaveBeenCalledWith({});
  });

  it("does not revoke sessions when only non-mode policy values change", async () => {
    const response = await PATCH(request({ ...currentPolicy, adminSessionTtlHours: 12 }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { reauthenticate: false } });
    expect(mocks.findActor).not.toHaveBeenCalled();
    expect(mocks.deleteSessions).not.toHaveBeenCalled();
    expect(mocks.deleteCookie).not.toHaveBeenCalled();
  });
});
