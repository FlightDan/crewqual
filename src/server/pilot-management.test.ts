import { beforeEach, describe, expect, it, vi } from "vitest";
import { importPilotCsv } from "./pilot-management";
import type { AuthenticatedAdmin } from "./auth";
const mocks = vi.hoisted(() => ({ getPrisma: vi.fn() }));
vi.mock("@/server/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/server/admin-repository", () => ({ getAdminPilot: vi.fn() }));
const admin = { id: "admin", roles: ["SUPER_ADMIN"], unitId: null } as AuthenticatedAdmin;
const qualificationType = {
  id: "medical",
  code: "medical",
  name: "Medical",
  version: 1,
  validityRule: { kind: "manual_expiry" },
  reminders: { firstDays: 90, secondDays: 30 },
  parameterRestriction: { enabled: false, description: "" },
  ocrChecks: {
    enabled: false,
    credentialNumber: false,
    holderMatch: false,
    expiryDate: false,
    issuingAuthoritySeal: false,
  },
};
const csv = [
  "employeeNumber,displayName,mobile,aircraftType,roleCode,unitCode,rankCode,medical.issueDate,medical.trainingDate,medical.expiryDate,medical.levelOrParameter",
  "CQ-2001,张三,13800138001,A320,CAPTAIN,HQ,CAPTAIN,2026-01-01,,2027-01-01,A320",
].join("\n");
function database() {
  const pilot = { id: "pilot", employeeNumber: "CQ-2001", version: 3 };
  const tx = {
    pilot: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(pilot),
    },
    qualificationRecord: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: "current", version: 8, lineageId: "lineage", revisionNumber: 5 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: "new" }),
    },
    auditEvent: { create: vi.fn() },
  };
  return {
    organizationUnit: {
      findMany: vi.fn().mockResolvedValue([{ id: "unit", code: "HQ", name: "HQ" }]),
    },
    qualificationType: { findMany: vi.fn().mockResolvedValue([qualificationType]) },
    pilot: { findMany: vi.fn().mockResolvedValue([pilot]) },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    tx,
  };
}
describe("CSV qualification revisions", () => {
  beforeEach(() => vi.clearAllMocks());
  it("retains the lineage and increments version when importing over a current record", async () => {
    const db = database();
    mocks.getPrisma.mockReturnValue(db);
    await importPilotCsv(admin, csv, "import", "merge", true);
    expect(db.tx.qualificationRecord.updateMany).toHaveBeenCalledWith({
      where: { id: "current", version: 8, status: "ACTIVE" },
      data: { status: "REPLACED", version: { increment: 1 } },
    });
    expect(db.tx.qualificationRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 9,
          revisionNumber: 6,
          lineageId: "lineage",
          supersedesRecordId: "current",
          action: "ADMIN_IMPORT",
        }),
      }),
    );
  });
  it("rejects a concurrent qualification update without creating a replacement", async () => {
    const db = database();
    db.tx.qualificationRecord.updateMany.mockResolvedValue({ count: 0 });
    mocks.getPrisma.mockReturnValue(db);
    await expect(importPilotCsv(admin, csv, "import", "merge", true)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
    });
    expect(db.tx.qualificationRecord.create).not.toHaveBeenCalled();
    expect(db.tx.auditEvent.create).not.toHaveBeenCalled();
  });
});
