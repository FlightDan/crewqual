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
  visiblePlan: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  currentPlan: vi.fn(),
  findAssignment: vi.fn(),
  updatePlan: vi.fn(),
  updateStage: vi.fn(),
  audit: vi.fn(),
  findResult: vi.fn(),
  notify: vi.fn(),
}));

const tx = {
  $queryRaw: mocks.queryRaw,
  upgradePlan: {
    findFirst: mocks.currentPlan,
    updateMany: mocks.updatePlan,
    findUnique: mocks.findResult,
  },
  upgradeStage: { update: mocks.updateStage },
  personPositionAssignment: { findUnique: mocks.findAssignment },
  auditEvent: { create: mocks.audit },
};

const db = {
  upgradePlan: { findFirst: mocks.visiblePlan },
  $transaction: mocks.transaction,
};

vi.mock("@/server/admin-guard", () => ({ getAdmin: () => Promise.resolve(mocks.admin) }));
vi.mock("@/server/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/server/admin-permissions", () => ({ relatedPilotUnitWhere: () => ({}) }));
vi.mock("@/server/serializers", () => ({ serializeUpgradePlan: (plan: unknown) => plan }));
vi.mock("@/server/notifications", () => ({ emitPilotNotification: mocks.notify }));
vi.mock("@/server/config", () => ({
  getServerConfig: () => ({ APP_ORIGIN: "http://crewqual.test" }),
}));

import { POST } from "@/app/api/admin/upgrade-plans/[id]/[action]/route";

const planId = "00000000-0000-4000-8000-000000000001";
const assignmentId = "00000000-0000-4000-8000-000000000002";
const personId = "00000000-0000-4000-8000-000000000003";
const pilotId = "00000000-0000-4000-8000-000000000004";

function makePlan() {
  return {
    id: planId,
    pilotId,
    personId,
    positionAssignmentId: assignmentId,
    lifecycleStatus: "DRAFT",
    version: 1,
    title: "晋升计划",
    stages: [{ id: "stage-1", status: "NOT_STARTED" }],
    pilot: { qualifications: [] },
  };
}

function request() {
  return new NextRequest(`http://crewqual.test/api/admin/upgrade-plans/${planId}/start`, {
    method: "POST",
    headers: { origin: "http://crewqual.test", "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

describe("upgrade plan lifecycle action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const plan = makePlan();
    mocks.visiblePlan.mockResolvedValue(plan);
    mocks.currentPlan.mockImplementation(async ({ where }: { where: { id?: unknown } }) =>
      typeof where.id === "string" ? plan : null,
    );
    mocks.findAssignment.mockResolvedValue({
      personId,
      status: "ACTIVE",
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-12-31T00:00:00.000Z"),
      position: { requirements: [] },
      person: {
        organizationId: "org-1",
        unitId: "unit-1",
        unit: { id: "unit-1", organizationId: "org-1", timezone: "Asia/Shanghai" },
      },
    });
    mocks.queryRaw.mockResolvedValue([]);
    mocks.updatePlan.mockResolvedValue({ count: 1 });
    mocks.updateStage.mockResolvedValue({});
    mocks.audit.mockResolvedValue({});
    mocks.findResult.mockResolvedValue(plan);
    mocks.notify.mockResolvedValue({ created: 0 });
    mocks.transaction.mockImplementation((callback) => callback(tx));
  });

  it("locks the plan and linked assignment before rechecking start eligibility", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ id: planId, action: "start" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.queryRaw.mock.calls[0]![0]).toEqual(
      expect.arrayContaining([expect.stringContaining('FROM "UpgradePlan"')]),
    );
    expect(mocks.queryRaw.mock.calls[1]![0]).toEqual(
      expect.arrayContaining([expect.stringContaining('FROM "PersonPositionAssignment"')]),
    );
    expect(mocks.updatePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: planId, lifecycleStatus: "DRAFT" }),
      }),
    );
  });

  it("rejects a plan when the assignment is no longer active inside the transaction", async () => {
    mocks.findAssignment.mockResolvedValue({
      personId,
      status: "ENDED",
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-12-31T00:00:00.000Z"),
      position: { requirements: [] },
      person: {
        organizationId: "org-1",
        unitId: "unit-1",
        unit: { id: "unit-1", organizationId: "org-1", timezone: "Asia/Shanghai" },
      },
    });

    const response = await POST(request(), {
      params: Promise.resolve({ id: planId, action: "start" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "POSITION_ASSIGNMENT_INACTIVE" },
    });
    expect(mocks.updatePlan).not.toHaveBeenCalled();
  });

  it("rejects a partially migrated association instead of falling back to legacy checks", async () => {
    const partialPlan = { ...makePlan(), positionAssignmentId: null };
    mocks.visiblePlan.mockResolvedValue(partialPlan);
    mocks.currentPlan.mockResolvedValue(partialPlan);

    const response = await POST(request(), {
      params: Promise.resolve({ id: planId, action: "start" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PLAN_SCOPE_MISMATCH" },
    });
    expect(mocks.findAssignment).not.toHaveBeenCalled();
    expect(mocks.updatePlan).not.toHaveBeenCalled();
  });
});
