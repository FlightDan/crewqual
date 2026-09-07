import { beforeEach, describe, expect, it, vi } from "vitest";
import { approveReview, correctReview, returnReview } from "@/server/admin-repository";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  enqueueInTransaction: vi.fn().mockResolvedValue("job-1"),
  emitPilotNotification: vi.fn().mockResolvedValue({ created: 1, queued: 0 }),
}));

vi.mock("@/server/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/server/jobs", () => ({
  QUEUES: { notifications: "crewqual.notifications" },
  enqueueInTransaction: mocks.enqueueInTransaction,
}));
vi.mock("@/server/notifications", () => ({
  emitPilotNotification: mocks.emitPilotNotification,
}));
vi.mock("@/server/storage", () => ({ getPrivateEvidenceUrl: vi.fn() }));

const admin = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@example.com",
  displayName: "Admin",
  roles: ["SUPER_ADMIN"],
  permissions: [],
  unitId: null,
  unitName: null,
  sessionId: "session-1",
  csrfToken: "csrf",
  expiresAt: new Date("2026-08-17T00:00:00.000Z"),
};

function ruleSnapshot(validityRule: unknown) {
  return {
    version: 1,
    validityRule,
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
}

function pendingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000010",
    pilotId: "00000000-0000-0000-0000-000000000020",
    qualificationTypeId: "00000000-0000-0000-0000-000000000030",
    qualificationRecordId: null,
    credentialNumber: "CERT-1",
    issueDate: new Date("2026-01-01T00:00:00.000Z"),
    expiryDate: new Date("2027-03-01T00:00:00.000Z"),
    issuingAuthority: "Authority",
    levelOrParameter: "A320",
    qualificationRuleSnapshot: ruleSnapshot({ kind: "manual_expiry" }),
    submittedFields: {},
    status: "PENDING",
    expectedVersion: 2,
    expectedQualificationRecordId: "record-current",
    baselineCapturedAt: new Date("2026-08-16T00:00:00Z"),
    version: 1,
    submittedAt: new Date("2026-08-16T00:00:00.000Z"),
    decidedAt: null,
    decisionNote: null,
    returnReason: null,
    pilot: {
      id: "00000000-0000-0000-0000-000000000020",
      employeeNumber: "CQ-1",
      displayName: "Pilot",
    },
    qualificationType: {
      id: "00000000-0000-0000-0000-000000000030",
      name: "Type",
      validityRule: { kind: "fixed_months", baseDateField: "issueDate", months: 12 },
      version: 2,
      reminders: { firstDays: 90, secondDays: 30 },
      parameterRestriction: { enabled: false, description: "" },
      ocrChecks: { enabled: false },
    },
    evidence: [],
    ...overrides,
  };
}

function approvalDb(
  request: ReturnType<typeof pendingRequest>,
  current: Record<string, unknown> | null,
) {
  const tx = {
    qualificationUpdateRequest: {
      findFirst: vi.fn().mockResolvedValue(request),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    qualificationRecord: {
      findFirst: vi.fn().mockResolvedValue(current),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: "record-new" }),
    },
    qualificationEvidence: { update: vi.fn() },
    evidenceImage: { update: vi.fn() },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    notificationDelivery: { create: vi.fn().mockResolvedValue({ id: "delivery-1" }) },
  };
  const db = {
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    qualificationUpdateRequest: {
      findFirst: vi.fn().mockResolvedValue({ pilotId: request.pilotId }),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    tx,
  };
  return db;
}

describe("admin review qualification consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects approval when the active record changed after submission", async () => {
    const request = pendingRequest({ expectedVersion: 2 });
    const db = approvalDb(request, { id: "record-current", version: 3, status: "ACTIVE" });
    mocks.getPrisma.mockReturnValue(db);

    await expect(
      approveReview(admin, request.id, { expectedVersion: 1, requestId: "request-1" }),
    ).rejects.toMatchObject({
      code: "QUALIFICATION_CHANGED_SINCE_SUBMISSION",
      status: 409,
    });
    expect(db.tx.qualificationRecord.create).not.toHaveBeenCalled();
    expect(db.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "qualification.approval_conflict" }),
      }),
    );
  });

  it("rejects a different record identity even when its numeric version is unchanged", async () => {
    const request = pendingRequest();
    const db = approvalDb(request, { id: "rolled-back-record", version: 2, status: "ACTIVE" });
    mocks.getPrisma.mockReturnValue(db);
    await expect(
      approveReview(admin, request.id, { expectedVersion: 1, requestId: "identity" }),
    ).rejects.toMatchObject({ code: "QUALIFICATION_CHANGED_SINCE_SUBMISSION", status: 409 });
    expect(db.tx.qualificationUpdateRequest.updateMany).not.toHaveBeenCalled();
    expect(db.tx.qualificationRecord.create).not.toHaveBeenCalled();
  });

  it.each([0, 2])(
    "rejects an unknown historical baseline at version %i without changing the request",
    async (expectedVersion) => {
      const request = pendingRequest({
        baselineCapturedAt: null,
        expectedQualificationRecordId: null,
        expectedVersion,
      });
      const db = approvalDb(request, null);
      mocks.getPrisma.mockReturnValue(db);
      await expect(
        approveReview(admin, request.id, { expectedVersion: 1, requestId: "unknown" }),
      ).rejects.toMatchObject({
        code: "QUALIFICATION_BASELINE_REQUIRES_RESUBMISSION",
        status: 409,
      });
      expect(db.tx.qualificationUpdateRequest.updateMany).not.toHaveBeenCalled();
      expect(db.tx.qualificationEvidence.update).not.toHaveBeenCalled();
      expect(db.tx.qualificationRecord.create).not.toHaveBeenCalled();
    },
  );

  it("allows a legacy request to be returned with an audit trail for resubmission", async () => {
    const request = pendingRequest({ baselineCapturedAt: null });
    const db = approvalDb(request, null);
    mocks.getPrisma.mockReturnValue(db);
    await returnReview(admin, request.id, "请核对当前资质后重新提交", 1, "return-legacy");
    expect(db.tx.qualificationUpdateRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RETURNED" }),
      }),
    );
    expect(db.tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "qualification.returned", entityId: request.id }),
      }),
    );
    expect(db.tx.qualificationEvidence.update).not.toHaveBeenCalled();
  });

  it("approves a captured absence as a first record", async () => {
    const request = pendingRequest({ expectedVersion: 0, expectedQualificationRecordId: null });
    const db = approvalDb(request, null);
    mocks.getPrisma.mockReturnValue(db);
    await approveReview(admin, request.id, { expectedVersion: 1, requestId: "first" });
    expect(db.tx.qualificationRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 1, revisionNumber: 1 }),
      }),
    );
  });

  it("rejects a first submission if a record has since been added", async () => {
    const request = pendingRequest({ expectedVersion: 0, expectedQualificationRecordId: null });
    const db = approvalDb(request, { id: "record-current", version: 1, status: "ACTIVE" });
    mocks.getPrisma.mockReturnValue(db);
    await expect(
      approveReview(admin, request.id, { expectedVersion: 1, requestId: "first-race" }),
    ).rejects.toMatchObject({ code: "QUALIFICATION_CHANGED_SINCE_SUBMISSION" });
    expect(db.tx.qualificationRecord.create).not.toHaveBeenCalled();
  });

  it("uses the submitted rule snapshot instead of the current qualification config", async () => {
    const request = pendingRequest();
    const db = approvalDb(request, { id: "record-current", version: 2, status: "ACTIVE" });
    mocks.getPrisma.mockReturnValue(db);

    await expect(
      approveReview(admin, request.id, { expectedVersion: 1, requestId: "request-2" }),
    ).resolves.toMatchObject({ id: "record-new" });
    expect(db.tx.qualificationRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ version: 2, status: "ACTIVE" }) }),
    );
  });

  it("rejects a correction that violates the submitted fixed-month rule", async () => {
    const request = pendingRequest({
      qualificationRuleSnapshot: ruleSnapshot({
        kind: "fixed_months",
        baseDateField: "issueDate",
        months: 12,
      }),
    });
    const db = {
      qualificationUpdateRequest: {
        findFirst: vi.fn().mockResolvedValue(request),
        updateMany: vi.fn(),
      },
      auditEvent: { create: vi.fn() },
    };
    mocks.getPrisma.mockReturnValue(db);

    await expect(
      correctReview(
        admin,
        request.id,
        {
          credentialNumber: "CERT-1",
          issueDate: "2026-01-01",
          trainingDate: "",
          expiryDate: "2027-03-01",
          issuingAuthority: "Authority",
          levelOrParameter: "A320",
        },
        1,
        "request-3",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    expect(db.qualificationUpdateRequest.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an approval whose rule snapshot is missing", async () => {
    const request = pendingRequest({ qualificationRuleSnapshot: null });
    const db = approvalDb(request, { id: "record-current", version: 2, status: "ACTIVE" });
    mocks.getPrisma.mockReturnValue(db);

    await expect(
      approveReview(admin, request.id, { expectedVersion: 1, requestId: "request-4" }),
    ).rejects.toMatchObject({ code: "QUALIFICATION_RULE_SNAPSHOT_INVALID", status: 409 });
  });

  it("does not auto-approve a pending request with an inferred backfill snapshot", async () => {
    const request = pendingRequest({
      qualificationRuleSnapshot: {
        ...ruleSnapshot({ kind: "manual_expiry" }),
        snapshotSource: "inferred_backfill",
      },
    });
    const db = approvalDb(request, { id: "record-current", version: 2, status: "ACTIVE" });
    mocks.getPrisma.mockReturnValue(db);

    await expect(
      approveReview(admin, request.id, { expectedVersion: 1, requestId: "request-5" }),
    ).rejects.toMatchObject({
      code: "QUALIFICATION_RULE_SNAPSHOT_REQUIRES_REVIEW",
      status: 409,
    });
    expect(db.tx.qualificationRecord.create).not.toHaveBeenCalled();
  });
});
