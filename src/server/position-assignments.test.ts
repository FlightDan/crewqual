import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedAdmin } from "@/server/auth";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  findAssignment: vi.fn(),
  findPlan: vi.fn(),
  updateAssignment: vi.fn(),
  updateQualificationAssignments: vi.fn(),
}));

const tx = {
  $queryRaw: mocks.queryRaw,
  personPositionAssignment: {
    findFirst: mocks.findAssignment,
    update: mocks.updateAssignment,
  },
  upgradePlan: { findFirst: mocks.findPlan },
  qualificationAssignment: { updateMany: mocks.updateQualificationAssignments },
};

vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({ $transaction: mocks.transaction }),
}));

import { endPositionAssignment } from "@/server/position-assignments";

const admin: AuthenticatedAdmin = {
  id: "admin-1",
  email: "admin@example.test",
  displayName: "Admin",
  roles: ["ADMIN"],
  permissions: ["pilots.write"],
  unitId: "unit-1",
  organizationId: "org-1",
  unitName: "Unit",
  sessionId: "session-1",
  csrfToken: "csrf-1",
  expiresAt: new Date("2026-12-31T00:00:00.000Z"),
};

describe("position assignment lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.queryRaw.mockResolvedValue([]);
    mocks.findAssignment.mockResolvedValue({
      id: "assignment-1",
      personId: "person-1",
      status: "ACTIVE",
      position: { code: "PILOT" },
    });
    mocks.findPlan.mockResolvedValue(null);
    mocks.updateAssignment.mockResolvedValue({ id: "assignment-1", status: "ENDED" });
    mocks.updateQualificationAssignments.mockResolvedValue({ count: 1 });
  });

  it("blocks ending an assignment while a DRAFT plan is still linked", async () => {
    mocks.findPlan.mockResolvedValue({ planNumber: "UP-DRAFT" });

    await expect(endPositionAssignment(admin, "person-1", "assignment-1")).rejects.toMatchObject({
      code: "ACTIVE_UPGRADE_PLAN",
      status: 409,
    });

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.findAssignment).toHaveBeenCalledTimes(2);
    expect(mocks.findPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          lifecycleStatus: { in: ["DRAFT", "NOT_STARTED", "ACTIVE", "PAUSED"] },
        }),
      }),
    );
    expect(mocks.updateAssignment).not.toHaveBeenCalled();
  });

  it("checks tenant visibility before locking and defers lifecycle mutation until after the lock", async () => {
    let releaseLock!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    mocks.queryRaw.mockImplementation(async () => {
      await lockAcquired;
    });

    const ending = endPositionAssignment(admin, "person-1", "assignment-1");
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.findAssignment).toHaveBeenCalledTimes(1);
    expect(mocks.findPlan).not.toHaveBeenCalled();
    expect(mocks.updateAssignment).not.toHaveBeenCalled();

    releaseLock();
    await expect(ending).resolves.toMatchObject({ id: "assignment-1", status: "ENDED" });
    expect(mocks.findAssignment).toHaveBeenCalledTimes(2);
    expect(mocks.findPlan).toHaveBeenCalledTimes(1);
    expect(mocks.updateAssignment).toHaveBeenCalledTimes(1);
  });

  it("does not lock an assignment outside the administrator scope", async () => {
    mocks.findAssignment.mockResolvedValueOnce(null);

    await expect(
      endPositionAssignment(admin, "person-1", "assignment-outside-scope"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.findPlan).not.toHaveBeenCalled();
    expect(mocks.updateAssignment).not.toHaveBeenCalled();
  });
});
