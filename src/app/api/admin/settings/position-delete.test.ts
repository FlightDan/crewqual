import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  admin: {
    id: "00000000-0000-4000-8000-000000000001",
    roles: ["SUPER_ADMIN"],
    permissions: ["settings.read", "settings.positions.write"],
    unitId: null,
    organizationId: null,
  },
  findPosition: vi.fn(),
  lockPosition: vi.fn(),
  deletePosition: vi.fn(),
  findAssignments: vi.fn(),
  findRequirements: vi.fn(),
  countQualificationAssignments: vi.fn(),
  countUpgradePlans: vi.fn(),
  updateAssignments: vi.fn(),
  updateQualificationAssignments: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
}));

const tx = {
  position: {
    findUnique: mocks.findPosition,
    updateMany: mocks.lockPosition,
    delete: mocks.deletePosition,
  },
  personPositionAssignment: {
    findMany: mocks.findAssignments,
    updateMany: mocks.updateAssignments,
  },
  qualificationRequirement: { findMany: mocks.findRequirements },
  qualificationAssignment: {
    count: mocks.countQualificationAssignments,
    updateMany: mocks.updateQualificationAssignments,
  },
  upgradePlan: { count: mocks.countUpgradePlans },
};

const db = {
  $transaction: mocks.transaction,
  auditEvent: { create: mocks.audit },
};

vi.mock("@/server/admin-guard", () => ({ getAdmin: () => Promise.resolve(mocks.admin) }));
vi.mock("@/server/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/server/auth", () => ({
  requirePermission: vi.fn(),
  hashPassword: vi.fn(),
}));
vi.mock("@/server/config", () => ({
  getServerConfig: () => ({ APP_ORIGIN: "http://crewqual.test" }),
}));
vi.mock("@/server/crypto", () => ({
  createTotpSecret: vi.fn(),
  decryptSettingSecret: vi.fn(),
  encryptSettingSecret: vi.fn(),
}));
vi.mock("@/server/external-endpoint-safety", () => ({ isLocalTestEndpoint: () => true }));

import { POST } from "@/app/api/admin/settings/route";

const positionId = "00000000-0000-4000-8000-000000000002";
const assignmentId = "00000000-0000-4000-8000-000000000003";
const requirementId = "00000000-0000-4000-8000-000000000004";

function request(force = false) {
  return new NextRequest("http://crewqual.test/api/admin/settings", {
    method: "POST",
    headers: { origin: "http://crewqual.test", "content-type": "application/json" },
    body: JSON.stringify({
      action: "position.delete",
      input: { id: positionId, version: 2, force },
    }),
  });
}

describe("position deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.admin.roles = ["SUPER_ADMIN"];
    mocks.admin.permissions = ["settings.read", "settings.positions.write"];
    mocks.admin.organizationId = null;
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.findPosition.mockResolvedValue({
      id: positionId,
      organizationId: "00000000-0000-4000-8000-000000000010",
      code: "PILOT",
      name: "飞行员",
      version: 2,
    });
    mocks.lockPosition.mockResolvedValue({ count: 1 });
    mocks.findAssignments.mockResolvedValue([{ id: assignmentId }]);
    mocks.findRequirements.mockResolvedValue([{ id: requirementId }]);
    mocks.countQualificationAssignments.mockResolvedValue(2);
    mocks.countUpgradePlans.mockResolvedValue(1);
    mocks.updateAssignments.mockResolvedValue({ count: 1 });
    mocks.updateQualificationAssignments.mockResolvedValue({ count: 1 });
    mocks.deletePosition.mockResolvedValue({ id: positionId });
    mocks.audit.mockResolvedValue({});
  });

  it("returns structured history counts instead of deleting", async () => {
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "POSITION_HAS_HISTORY",
        details: {
          memberAssignments: 1,
          qualificationRequirements: 1,
          qualificationAssignments: 2,
          upgradePlans: 1,
        },
      },
    });
    expect(mocks.deletePosition).not.toHaveBeenCalled();
  });

  it("allows only super admins to force delete and preserves linked history", async () => {
    const response = await POST(request(true));
    expect(response.status).toBe(200);
    expect(mocks.updateAssignments).toHaveBeenCalledTimes(2);
    expect(mocks.updateQualificationAssignments).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ active: true }),
        data: expect.objectContaining({ active: false }),
      }),
    );
    expect(mocks.deletePosition).toHaveBeenCalledWith({ where: { id: positionId } });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "settings.position.force_deleted" }),
      }),
    );

    mocks.admin.roles = ["ADMIN"];
    const forbidden = await POST(request(true));
    expect(forbidden.status).toBe(403);
  });
});
