import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  unit: vi.fn(),
  role: vi.fn(),
  current: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  deleteRoles: vi.fn(),
  createRole: vi.fn(),
  deleteSessions: vi.fn(),
  read: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
}));
const tx = {
  organizationUnit: { findUnique: mocks.unit },
  role: { findUniqueOrThrow: mocks.role },
  adminUser: { findUnique: mocks.current, update: mocks.update, create: mocks.create },
  adminUserRole: { deleteMany: mocks.deleteRoles, create: mocks.createRole },
  adminSession: { deleteMany: mocks.deleteSessions },
};
vi.mock("@/server/admin-guard", () => ({
  getAdmin: async () => ({
    id: "00000000-0000-4000-8000-000000000001",
    roles: ["SUPER_ADMIN"],
    permissions: ["settings.read", "settings.admins.write"],
    unitId: null,
  }),
}));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({
    $transaction: mocks.transaction,
    adminUser: { findUniqueOrThrow: mocks.read },
    auditEvent: { create: mocks.audit },
  }),
}));
vi.mock("@/server/auth", () => ({ requirePermission: vi.fn(), hashPassword: async () => "hash" }));
vi.mock("@/server/crypto", () => ({
  createTotpSecret: () => "ABCDEFGHIJKLMNOP",
  encryptSettingSecret: () => "encrypted",
}));
import { PATCH, POST } from "./route";

const target = "00000000-0000-4000-8000-000000000002";
const unitId = "00000000-0000-4000-8000-000000000003";
const organizationId = "00000000-0000-4000-8000-000000000004";
async function save(action: "save" | "create", input = {}) {
  const method = action === "save" ? "PATCH" : "POST";
  const request = new NextRequest("http://crewqual.test/api/admin/settings", {
    method,
    headers: { origin: "http://crewqual.test", "content-type": "application/json" },
    body: JSON.stringify({
      action: `admin.${action}`,
      input: {
        id: target,
        displayName: "Target",
        email: "target@example.test",
        unitId,
        role: "ADMIN",
        active: true,
        temporaryPassword: "temporary-password",
        ...input,
      },
    }),
  });
  return (action === "save" ? PATCH : POST)(request);
}

describe("administrator organization and unit assignment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.unit.mockResolvedValue({
      id: unitId,
      active: true,
      organizationId,
      organization: { id: organizationId },
    });
    mocks.role.mockResolvedValue({ id: "role-admin" });
    mocks.current.mockResolvedValue({ active: true, roles: [{ role: { code: "ADMIN" } }] });
    mocks.create.mockResolvedValue({ id: target });
    mocks.read.mockResolvedValue({
      id: target,
      displayName: "Target",
      email: "target@example.test",
      active: true,
      unitId,
      unit: { name: "Unit" },
      roles: [{ role: { code: "ADMIN" } }],
      sessions: [],
    });
  });

  it.each(["save", "create"] as const)(
    "%s derives the organization from the unit inside the account transaction",
    async (action) => {
      expect((await save(action)).status).toBe(action === "save" ? 200 : 201);
      expect(mocks.transaction).toHaveBeenCalledTimes(1);
      expect(action === "save" ? mocks.update : mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ unitId, organizationId }) }),
      );
      expect(mocks.unit).toHaveBeenCalledWith(expect.objectContaining({ where: { id: unitId } }));
      if (action === "save") {
        expect(mocks.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ version: { increment: 1 } }) }),
        );
        expect(mocks.createRole).toHaveBeenCalledWith({
          data: { userId: target, roleId: "role-admin" },
        });
      }
    },
  );

  it.each([
    null,
    { id: unitId, active: false, organizationId },
    { id: unitId, active: true, organizationId: null },
    { id: unitId, active: true, organizationId, organization: { id: unitId } },
  ])("rejects an invalid unit relation before account or roles change", async (unit) => {
    mocks.unit.mockResolvedValue(unit);
    for (const action of ["save", "create"] as const) expect((await save(action)).status).toBe(422);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.deleteRoles).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("clears both scope fields on promotion to super administrator", async () => {
    expect((await save("save", { role: "SUPER_ADMIN", unitId: null })).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ unitId: null, organizationId: null }),
      }),
    );
    expect(mocks.unit).not.toHaveBeenCalled();
  });

  it("removes sessions in the transaction on deactivation", async () => {
    expect((await save("save", { active: false })).status).toBe(200);
    expect(mocks.deleteSessions).toHaveBeenCalledWith({ where: { userId: target } });
  });

  it("does not return success or audit when a transactional role change fails", async () => {
    mocks.createRole.mockRejectedValue(new Error("role write failed"));
    expect((await save("save")).status).toBe(500);
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each([null, "invalid"])(
    "requires a valid UUID unit for ordinary administrators",
    async (value) => {
      expect((await save("save", { unitId: value })).status).toBe(422);
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );
});
