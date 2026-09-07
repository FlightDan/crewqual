import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  admin: {
    id: "admin-1",
    roles: ["ADMIN"],
    permissions: ["operations.write"],
    unitId: "unit-1",
    organizationId: "org-1",
  },
  findPlan: vi.fn(),
  findTarget: vi.fn(),
  transaction: vi.fn(),
  updatePlan: vi.fn(),
  queryRaw: vi.fn(),
  findLockedAssignment: vi.fn(),
  createAudit: vi.fn(),
  findResult: vi.fn(),
}));

const tx = {
  $queryRaw: mocks.queryRaw,
  upgradePlan: { updateMany: mocks.updatePlan, findUniqueOrThrow: mocks.findResult },
  personPositionAssignment: { findFirst: mocks.findLockedAssignment },
  auditEvent: { create: mocks.createAudit },
};

const db = {
  upgradePlan: { findFirst: mocks.findPlan },
  pilot: { findFirst: mocks.findTarget },
  $transaction: mocks.transaction,
};

vi.mock("@/server/admin-guard", () => ({ getAdmin: () => Promise.resolve(mocks.admin) }));
vi.mock("@/server/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/server/admin-permissions", () => ({
  isSuperAdmin: () => false,
  pilotUnitWhere: () => ({}),
  relatedPilotUnitWhere: () => ({}),
}));
vi.mock("@/server/serializers", () => ({ serializeUpgradePlan: (plan: unknown) => plan }));
vi.mock("@/server/config", () => ({
  getServerConfig: () => ({ APP_ORIGIN: "http://crewqual.test" }),
}));

import { POST } from "@/app/api/admin/upgrade-plans/[id]/reassign/route";

const planId = "00000000-0000-4000-8000-000000000001";
const oldPilotId = "00000000-0000-4000-8000-000000000002";
const targetPilotId = "00000000-0000-4000-8000-000000000003";
const targetPersonId = "00000000-0000-4000-8000-000000000004";
const targetAssignmentId = "00000000-0000-4000-8000-000000000005";

function request() {
  return new NextRequest(`http://crewqual.test/api/admin/upgrade-plans/${planId}/reassign`, {
    method: "POST",
    headers: { origin: "http://crewqual.test", "content-type": "application/json" },
    body: JSON.stringify({
      pilotId: targetPilotId,
      expectedVersion: 1,
      reason: "调配至目标人员",
    }),
  });
}

describe("upgrade plan reassignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findPlan.mockResolvedValue({
      id: planId,
      pilotId: oldPilotId,
      lifecycleStatus: "DRAFT",
      version: 1,
      pilot: { unit: { organizationId: "org-1" } },
      stages: [],
    });
    mocks.findTarget.mockResolvedValue({
      id: targetPilotId,
      active: true,
      unit: { organizationId: "org-1" },
      person: {
        id: targetPersonId,
        positionAssignments: [
          {
            id: targetAssignmentId,
            positionCodeSnapshot: "PILOT",
            positionNameSnapshot: "飞行员",
            position: { code: "PILOT", name: "飞行员" },
          },
        ],
      },
    });
    mocks.updatePlan.mockResolvedValue({ count: 1 });
    mocks.queryRaw.mockResolvedValue([]);
    mocks.findLockedAssignment.mockResolvedValue({ id: targetAssignmentId });
    mocks.createAudit.mockResolvedValue({});
    mocks.findResult.mockResolvedValue({ id: planId, stages: [], inspectionItems: [] });
    mocks.transaction.mockImplementation((callback) => callback(tx));
  });

  it("locks and rechecks the target assignment after acquiring the plan row lock", async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: planId }) });

    expect(response.status).toBe(200);
    expect(mocks.findLockedAssignment).toHaveBeenCalledWith({
      where: { id: targetAssignmentId, personId: targetPersonId, status: "ACTIVE" },
      select: { id: true },
    });
    expect(mocks.updatePlan.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.queryRaw.mock.invocationCallOrder[0]!,
    );
  });

  it("rejects reassignment when the target assignment ended during the request", async () => {
    mocks.findLockedAssignment.mockResolvedValue(null);

    const response = await POST(request(), { params: Promise.resolve({ id: planId }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "POSITION_ASSIGNMENT_INACTIVE" },
    });
    expect(mocks.createAudit).not.toHaveBeenCalled();
  });
});
