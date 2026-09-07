import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { UPGRADE_STAGE_CODES } from "@/types/services";

const mocks = vi.hoisted(() => ({
  admin: {
    id: "admin-1",
    roles: ["ADMIN"],
    permissions: ["operations.write"],
    unitId: "unit-1",
    organizationId: "org-1",
  },
  findPilot: vi.fn(),
  findInspectionItems: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  findLockedAssignment: vi.fn(),
  findConflict: vi.fn(),
  createPlan: vi.fn(),
  createInspectionItems: vi.fn(),
  createAudit: vi.fn(),
  findResult: vi.fn(),
  notify: vi.fn(),
}));

const tx = {
  $queryRaw: mocks.queryRaw,
  personPositionAssignment: { findFirst: mocks.findLockedAssignment },
  upgradePlan: {
    findFirst: mocks.findConflict,
    create: mocks.createPlan,
    findUniqueOrThrow: mocks.findResult,
  },
  upgradePlanInspectionItem: { createMany: mocks.createInspectionItems },
  auditEvent: { create: mocks.createAudit },
};

const db = {
  pilot: { findFirst: mocks.findPilot },
  inspectionItem: { findMany: mocks.findInspectionItems },
  upgradePlan: { findFirst: mocks.findConflict },
  $transaction: mocks.transaction,
};

vi.mock("@/server/admin-guard", () => ({ getAdmin: () => Promise.resolve(mocks.admin) }));
vi.mock("@/server/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/server/admin-permissions", () => ({
  pilotUnitWhere: () => ({}),
  relatedPilotUnitWhere: () => ({}),
}));
vi.mock("@/server/serializers", () => ({ serializeUpgradePlan: (plan: unknown) => plan }));
vi.mock("@/server/notifications", () => ({ emitPilotNotification: mocks.notify }));
vi.mock("@/server/config", () => ({
  getServerConfig: () => ({ APP_ORIGIN: "http://crewqual.test" }),
}));

import { POST } from "@/app/api/admin/upgrade-plans/route";

const pilotId = "00000000-0000-4000-8000-000000000001";
const personId = "00000000-0000-4000-8000-000000000002";
const assignmentId = "00000000-0000-4000-8000-000000000003";
const inspectionItemId = "00000000-0000-4000-8000-000000000004";
const planId = "00000000-0000-4000-8000-000000000005";

function request() {
  const stages = UPGRADE_STAGE_CODES.map((code, index) => ({
    id: `stage-input-${index}`,
    code,
    name: `节点 ${index + 1}`,
    status: "not_started",
    plannedStart: "2026-09-01",
    plannedEnd: "2026-09-01",
    owner: "负责人",
    notes: "",
  }));
  return new NextRequest("http://crewqual.test/api/admin/upgrade-plans", {
    method: "POST",
    headers: { origin: "http://crewqual.test", "content-type": "application/json" },
    body: JSON.stringify({
      action: "save",
      pilotId,
      title: "机长升级计划",
      type: "captain_upgrade",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      overallOwner: "总负责人",
      leadDepartment: "运行部",
      stages,
      inspectionItemSelections: [{ inspectionItemId, stageOrder: 0 }],
      supplementalRequirements: [],
    }),
  });
}

describe("upgrade plan creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findPilot.mockResolvedValue({
      id: pilotId,
      personId,
      qualifications: [],
      person: {
        positionAssignments: [
          {
            id: assignmentId,
            positionCodeSnapshot: "PILOT",
            positionNameSnapshot: "飞行员",
            position: { code: "PILOT", name: "飞行员" },
          },
        ],
      },
    });
    mocks.findInspectionItems.mockResolvedValue([
      { id: inspectionItemId, name: "检查项目", ruleVersion: 1, rule: {} },
    ]);
    mocks.queryRaw.mockResolvedValue([]);
    mocks.findLockedAssignment.mockResolvedValue({ id: assignmentId });
    mocks.findConflict.mockResolvedValue(null);
    const stages = UPGRADE_STAGE_CODES.map((_, order) => ({ id: `stage-${order}`, order }));
    mocks.createPlan.mockResolvedValue({ id: planId, stages });
    mocks.createInspectionItems.mockResolvedValue({ count: 1 });
    mocks.createAudit.mockResolvedValue({});
    mocks.findResult.mockResolvedValue({ id: planId, stages, inspectionItems: [] });
    mocks.notify.mockResolvedValue({ created: 0 });
    mocks.transaction.mockImplementation((callback) => callback(tx));
  });

  it("locks and rechecks the assignment before creating a draft", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.queryRaw.mock.calls[0]![0]).toEqual(
      expect.arrayContaining([expect.stringContaining('FROM "PersonPositionAssignment"')]),
    );
    expect(mocks.findLockedAssignment).toHaveBeenCalledWith({
      where: { id: assignmentId, personId, status: "ACTIVE" },
      select: { id: true },
    });
    expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createPlan.mock.invocationCallOrder[0]!,
    );
  });

  it("rejects creation when the assignment ended while the request waited for the lock", async () => {
    mocks.findLockedAssignment.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "POSITION_ASSIGNMENT_INACTIVE" },
    });
    expect(mocks.createPlan).not.toHaveBeenCalled();
  });
});
