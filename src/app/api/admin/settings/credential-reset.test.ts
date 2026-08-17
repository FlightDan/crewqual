import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  deleteMany: vi.fn(),
  findUser: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
}));

const tx = {
  adminUser: { update: mocks.update },
  adminSession: { deleteMany: mocks.deleteMany },
};
const db = {
  $transaction: mocks.transaction,
  adminUser: { findUniqueOrThrow: mocks.findUser },
  auditEvent: { create: mocks.audit },
};

vi.mock("@/server/admin-guard", () => ({
  getAdmin: () =>
    Promise.resolve({
      id: "00000000-0000-4000-8000-000000000001",
      roles: ["SUPER_ADMIN"],
      permissions: ["settings.read", "settings.admins.write"],
      unitId: null,
    }),
}));
vi.mock("@/server/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/server/auth", () => ({
  requirePermission: vi.fn(),
  hashPassword: () => Promise.resolve("new-hash"),
}));
vi.mock("@/server/crypto", () => ({
  createTotpSecret: () => "ABCDEFGHIJKLMNOP",
  encryptSettingSecret: () => "v1:encrypted",
  decryptSettingSecret: vi.fn(),
}));

import { POST } from "@/app/api/admin/settings/route";

const target = "00000000-0000-4000-8000-000000000002";
function request(action: "resetPassword" | "resetTotp") {
  return new NextRequest("http://crewqual.test/api/admin/settings", {
    method: "POST",
    headers: { origin: "http://crewqual.test", "content-type": "application/json" },
    body: JSON.stringify({
      action: "admin.action",
      input: {
        id: target,
        action,
        ...(action === "resetPassword" ? { value: "temporary-password-123" } : {}),
      },
    }),
  });
}

describe("administrator credential reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.findUser.mockResolvedValue({
      id: target,
      displayName: "Target",
      email: "target@example.test",
      unitId: null,
      unit: null,
      active: true,
      totpSecretCiphertext: "v1:encrypted",
      roles: [{ role: { code: "ADMIN" } }],
      sessions: [],
    });
    mocks.audit.mockResolvedValue({});
  });

  it.each(["resetPassword", "resetTotp"] as const)(
    "revokes every existing session in the same transaction for %s",
    async (action) => {
      const response = await POST(request(action));
      expect(response.status).toBe(200);
      expect(mocks.transaction).toHaveBeenCalledTimes(1);
      expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { userId: target } });
      expect(mocks.update).toHaveBeenCalled();
    },
  );
});
