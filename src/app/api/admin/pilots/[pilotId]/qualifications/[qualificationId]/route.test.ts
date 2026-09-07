import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ getPrisma: vi.fn(), getAdmin: vi.fn() }));
vi.mock("@/server/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/server/admin-guard", () => ({ getAdmin: mocks.getAdmin }));
import { PATCH } from "./route";
const current = {
  id: "current",
  pilotId: "pilot",
  qualificationTypeId: "type",
  version: 9,
  lineageId: "lineage",
  revisionNumber: 3,
  credentialNumber: "old",
  issueDate: new Date("2026-01-01Z"),
  trainingDate: null,
  expiryDate: new Date("2027-01-01Z"),
  issuingAuthority: "authority",
  levelOrParameter: "level",
  qualificationRuleSnapshot: { validityRule: { kind: "manual_expiry" } },
  qualificationType: {
    code: "medical",
    name: "Medical",
    version: 1,
    validityRule: { kind: "manual_expiry" },
    reminders: { firstDays: 90, secondDays: 30 },
    ocrChecks: {
      enabled: false,
      credentialNumber: false,
      holderMatch: false,
      expiryDate: false,
      issuingAuthoritySeal: false,
    },
    parameterRestriction: { enabled: false, description: "" },
  },
};
function database() {
  const tx = {
    qualificationRecord: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ ...current, id: "new", version: 10 }),
    },
    qualificationCorrection: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  return {
    qualificationRecord: { findFirst: vi.fn().mockResolvedValue(current) },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    tx,
  };
}
function request() {
  return new NextRequest("http://localhost:3000/api/admin/pilots/pilot/qualifications/medical", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedVersion: 9,
      credentialNumber: "corrected",
      issueDate: "2026-01-01",
      expiryDate: "2027-01-01",
      issuingAuthority: "authority",
      levelOrParameter: "level",
    }),
  });
}
describe("administrator qualification revision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdmin.mockResolvedValue({ id: "admin", roles: ["SUPER_ADMIN"] });
  });
  it("increments the current version while retaining history", async () => {
    const db = database();
    mocks.getPrisma.mockReturnValue(db);
    expect(
      (
        await PATCH(request(), {
          params: Promise.resolve({ pilotId: "pilot", qualificationId: "medical" }),
        })
      ).status,
    ).toBe(200);
    expect(db.tx.qualificationRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 10,
          revisionNumber: 4,
          lineageId: "lineage",
          supersedesRecordId: "current",
          qualificationRuleSnapshot: expect.objectContaining({
            snapshotSource: "reviewer_confirmed",
            validityRule: { kind: "manual_expiry" },
          }),
        }),
      }),
    );
  });
  it("rejects a lost compare-and-swap before writing a revision", async () => {
    const db = database();
    db.tx.qualificationRecord.updateMany.mockResolvedValue({ count: 0 });
    mocks.getPrisma.mockReturnValue(db);
    expect(
      (
        await PATCH(request(), {
          params: Promise.resolve({ pilotId: "pilot", qualificationId: "medical" }),
        })
      ).status,
    ).toBe(409);
    expect(db.tx.qualificationRecord.create).not.toHaveBeenCalled();
    expect(db.tx.qualificationCorrection.create).not.toHaveBeenCalled();
  });
});
