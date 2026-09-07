import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authenticatePilot: vi.fn(),
  assertCsrf: vi.fn(),
  findQualification: vi.fn(),
  findPilot: vi.fn(),
  findDefinition: vi.fn(),
  findImage: vi.fn(),
  findRecord: vi.fn(),
  transaction: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  authenticatePilot: mocks.authenticatePilot,
  assertCsrf: mocks.assertCsrf,
}));
vi.mock("@/server/jobs", () => ({
  QUEUES: { recognition: "recognition" },
  enqueueInTransaction: mocks.enqueue,
}));
vi.mock("@/server/runtime-settings", () => ({
  getRuntimeIntegration: vi.fn().mockResolvedValue({
    retryLimit: 3,
    model: "fake-vlm",
    adapter: "qwen",
  }),
}));
vi.mock("@/server/qualification-verification", () => ({
  persistVerificationForEvidence: vi.fn(),
}));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({
    qualificationType: { findFirst: mocks.findQualification },
    pilot: { findUnique: mocks.findPilot },
    qualificationDefinition: { findFirst: mocks.findDefinition },
    evidenceImage: { findFirst: mocks.findImage },
    qualificationRecord: { findFirst: mocks.findRecord },
    $transaction: mocks.transaction,
  }),
}));

import { POST } from "@/app/api/pilot/submissions/route";

const qualification = {
  id: "qualification-type-1",
  code: "medical",
  validityRule: { kind: "manual_expiry" },
  version: 1,
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

const image = {
  id: "evidence-1",
  pilotId: "pilot-1",
  status: "orphaned",
};

function request(expectedVersion?: number, overrides: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost:3000/api/pilot/submissions", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "x-csrf-token": "csrf-token",
      "x-request-id": "submission-create-request",
    },
    body: JSON.stringify({
      qualificationId: "medical",
      evidenceId: "00000000-0000-4000-8000-000000000001",
      credentialNumber: "MED-001",
      issueDate: "2026-08-15",
      trainingDate: null,
      expiryDate: "2027-08-15",
      issuingAuthority: "民航局",
      levelOrParameter: "一级",
      ...overrides,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    }),
  });
}

function transactionClient(overrides: Record<string, unknown> = {}) {
  return {
    qualificationRecord: { findFirst: mocks.findRecord },
    qualificationUpdateRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockResolvedValue({ id: "request-1", submittedAt: new Date("2026-08-16T00:00:00Z") }),
      ...overrides,
    },
    evidenceImage: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    qualificationEvidence: { create: vi.fn() },
    recognitionTask: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ id: "recognition-1", status: "QUEUED", result: null }),
    },
    auditEvent: { create: vi.fn() },
  };
}

describe("pilot submission create route error contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticatePilot.mockResolvedValue({ id: "pilot-1", csrfToken: "csrf-hash" });
    mocks.assertCsrf.mockResolvedValue(undefined);
    mocks.findQualification.mockResolvedValue(qualification);
    mocks.findPilot.mockResolvedValue({
      personId: "person-1",
      person: { organizationId: "organization-1" },
    });
    mocks.findDefinition.mockResolvedValue({ id: "definition-1" });
    mocks.findImage.mockResolvedValue(image);
    mocks.findRecord.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(transactionClient()),
    );
  });

  it("returns NOT_FOUND when the qualification is inactive or missing", async () => {
    mocks.findQualification.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND", requestId: "submission-create-request" },
    });
  });

  it("does not reveal another pilot's evidence", async () => {
    mocks.findImage.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND", requestId: "submission-create-request" },
    });
  });

  it("persists the canonical links and can resolve a bootstrap-installed definition by code", async () => {
    const tx = transactionClient();
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    );

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.findDefinition).toHaveBeenCalledWith({
      where: {
        organizationId: "organization-1",
        active: true,
        OR: [{ legacyQualificationTypeId: "qualification-type-1" }, { code: "medical" }],
      },
      select: { id: true },
    });
    expect(tx.qualificationUpdateRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          personId: "person-1",
          qualificationDefinitionId: "definition-1",
          expectedQualificationRecordId: null,
          expectedVersion: 0,
          baselineCapturedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("captures the current record identity and version in the submission transaction", async () => {
    mocks.findRecord.mockResolvedValue({ id: "active-record", version: 7 });
    const tx = transactionClient();
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    );
    expect((await POST(request(7))).status).toBe(201);
    expect(tx.qualificationUpdateRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          expectedQualificationRecordId: "active-record",
          expectedVersion: 7,
          baselineCapturedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("rejects already-linked evidence and optimistic version conflicts", async () => {
    mocks.findImage.mockResolvedValue({ ...image, status: "linked" });
    let response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EVIDENCE_UNAVAILABLE" },
    });

    mocks.findImage.mockResolvedValue(image);
    mocks.findRecord.mockResolvedValue({ version: 2 });
    response = await POST(request(1));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VERSION_CONFLICT" } });
  });

  it("rejects duplicate pending submissions and evidence claim races", async () => {
    const duplicateClient = transactionClient({
      findFirst: vi.fn().mockResolvedValue({ id: "existing-request" }),
    });
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) =>
      callback(duplicateClient),
    );
    let response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "DUPLICATE_SUBMISSION" },
    });

    const racedClient = transactionClient();
    racedClient.evidenceImage.updateMany.mockResolvedValue({ count: 0 });
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) =>
      callback(racedClient),
    );
    response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EVIDENCE_UNAVAILABLE" },
    });
  });

  it("uses trainingDate and server-normalizes a fixed-month expiry", async () => {
    mocks.findQualification.mockResolvedValue({
      ...qualification,
      validityRule: { kind: "fixed_months", baseDateField: "trainingDate", months: 1 },
    });
    const tx = transactionClient();
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    );

    const response = await POST(
      request(undefined, {
        issueDate: "2026-01-01",
        trainingDate: "2026-01-31",
        expiryDate: null,
      }),
    );

    expect(response.status).toBe(201);
    expect(tx.qualificationUpdateRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          trainingDate: new Date("2026-01-31T00:00:00.000Z"),
          expiryDate: new Date("2026-02-28T00:00:00.000Z"),
          submittedFields: expect.objectContaining({
            trainingDate: "2026-01-31",
            expiryDate: "2026-02-28",
          }),
        }),
      }),
    );
  });
});
