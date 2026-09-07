import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getPrisma: vi.fn(), getAdmin: vi.fn(), notify: vi.fn() }));
vi.mock("@/server/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/server/admin-guard", () => ({ getAdmin: mocks.getAdmin }));
vi.mock("@/server/notifications", () => ({ emitPilotNotification: mocks.notify }));
import { POST } from "./route";

const currentId = "00000000-0000-4000-8000-000000000001";
const targetId = "00000000-0000-4000-8000-000000000002";
const current = {
  id: currentId,
  version: 7,
  revisionNumber: 4,
  lineageId: "lineage",
  pilotId: "pilot",
  personId: "person",
  qualificationTypeId: "type",
  qualificationDefinitionId: "definition",
  status: "ACTIVE",
  evidence: [],
};
const target = {
  ...current,
  id: targetId,
  version: 2,
  revisionNumber: 1,
  status: "REPLACED",
  qualificationRuleSnapshot: { validityRule: { kind: "no_expiry" } },
  credentialNumber: "historical",
  evidence: [{ evidenceImageId: "historical-image" }],
};
function request() {
  return new NextRequest("http://localhost:3000/api/admin/qualification-records/rollback", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({
      targetRevisionId: targetId,
      expectedCurrentRevisionId: currentId,
      expectedVersion: 7,
      reason: "恢复已核对的历史记录",
    }),
  });
}
function database() {
  const tx = {
    qualificationRecord: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: "replacement", version: 8 }),
    },
    qualificationEvidence: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  return {
    qualificationRecord: {
      findFirst: vi.fn().mockResolvedValue(current),
      findUnique: vi.fn().mockResolvedValue(target),
    },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    tx,
  };
}
describe("qualification rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdmin.mockResolvedValue({ id: "admin", roles: ["SUPER_ADMIN"], unitId: null });
  });
  it("increments the current version and preserves historical evidence and rule snapshot", async () => {
    const db = database();
    mocks.getPrisma.mockReturnValue(db);
    expect(
      (await POST(request(), { params: Promise.resolve({ recordId: currentId }) })).status,
    ).toBe(200);
    expect(db.tx.qualificationRecord.updateMany).toHaveBeenCalledWith({
      where: { id: currentId, status: "ACTIVE", version: 7 },
      data: { status: "REPLACED", version: { increment: 1 } },
    });
    expect(db.tx.qualificationRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 8,
          revisionNumber: 5,
          supersedesRecordId: currentId,
          restoresRecordId: targetId,
          qualificationRuleSnapshot: target.qualificationRuleSnapshot,
          credentialNumber: "historical",
        }),
      }),
    );
    expect(db.tx.qualificationEvidence.create).toHaveBeenCalledWith({
      data: {
        evidenceImageId: "historical-image",
        qualificationRecordId: "replacement",
      },
    });
    expect(target.evidence).toEqual([{ evidenceImageId: "historical-image" }]);
  });
  it("stops a concurrent replacement before copying evidence or notifying", async () => {
    const db = database();
    db.tx.qualificationRecord.updateMany.mockResolvedValue({ count: 0 });
    mocks.getPrisma.mockReturnValue(db);
    const response = await POST(request(), { params: Promise.resolve({ recordId: currentId }) });
    expect(response.status).toBe(409);
    expect(db.tx.qualificationRecord.create).not.toHaveBeenCalled();
    expect(db.tx.qualificationEvidence.create).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("rejects a historical revision belonging to another person", async () => {
    const db = database();
    db.qualificationRecord.findUnique.mockResolvedValue({ ...target, personId: "another-person" });
    mocks.getPrisma.mockReturnValue(db);
    expect(
      (await POST(request(), { params: Promise.resolve({ recordId: currentId }) })).status,
    ).toBe(422);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
