// @vitest-environment node
/** Real Prisma/PostgreSQL transactions and the actual rollback route handler.
 * Authentication, outbound notifications and storage are boundary stubs; this is
 * database integration evidence, not an HTTP/browser or provider-delivery test.
 * Fixtures/cleanup use a separate owner URL; business mutations use the restricted
 * runtime URL. All fixtures have random UUIDs and cleanup touches only those IDs.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import type { AuthenticatedAdmin } from "@/server/auth";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getAdmin: vi.fn(),
  notify: vi.fn().mockResolvedValue({ created: 0, queued: 0 }),
}));
vi.mock("@/server/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/server/admin-guard", () => ({ getAdmin: mocks.getAdmin }));
vi.mock("@/server/notifications", () => ({ emitPilotNotification: mocks.notify }));
vi.mock("@/server/storage", () => ({ getPrivateEvidenceUrl: vi.fn() }));
import { approveReview } from "@/server/admin-repository";
import { POST as rollback } from "@/app/api/admin/qualification-records/[recordId]/rollback/route";

const runtimeUrl = process.env.QUALIFICATION_TEST_DATABASE_URL;
const ownerUrl = process.env.QUALIFICATION_TEST_DIRECT_URL ?? process.env.DIRECT_URL;
const unitId = randomUUID();
const typeId = randomUUID();
const pilotIds: string[] = [];
const admin = {
  id: randomUUID(),
  displayName: "Integration admin",
  roles: ["ADMIN"],
  unitId,
} as AuthenticatedAdmin;
const snapshot = {
  version: 1,
  snapshotSource: "captured",
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
} satisfies Prisma.InputJsonObject;
const fields = {
  credentialNumber: "integration-certificate",
  issueDate: new Date("2026-01-01T00:00:00Z"),
  expiryDate: new Date("2027-01-01T00:00:00Z"),
  issuingAuthority: "Integration authority",
  levelOrParameter: "A320",
  qualificationRuleSnapshot: snapshot,
};
function client(connectionString: string) {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 4,
      connectionTimeoutMillis: 5000,
    }),
  });
}

describe.skipIf(!runtimeUrl)("qualification revisions on migrated PostgreSQL", () => {
  let owner: PrismaClient;
  let runtime: PrismaClient;
  beforeAll(async () => {
    if (!ownerUrl)
      throw new Error(
        "QUALIFICATION_TEST_DIRECT_URL (fixture owner) is required with QUALIFICATION_TEST_DATABASE_URL",
      );
    owner = client(ownerUrl);
    runtime = client(runtimeUrl!);
    const [runtimeRole] = await runtime.$queryRaw<
      Array<{ name: string; superuser: boolean }>
    >`SELECT current_user AS name, rolsuper AS superuser FROM pg_roles WHERE rolname = current_user`;
    const [ownerRole] = await owner.$queryRaw<Array<{ name: string }>>`SELECT current_user AS name`;
    expect(runtimeRole!.superuser).toBe(false);
    expect(runtimeRole!.name).not.toBe(ownerRole!.name);
    console.info(
      JSON.stringify({
        qualificationIntegration: {
          runtimeRole: runtimeRole!.name,
          fixtureRole: ownerRole!.name,
          boundaryStubs: ["authentication", "notification", "storage"],
          transport: "direct function / Next route invocation",
        },
      }),
    );
    await owner.organizationUnit.create({
      data: {
        id: unitId,
        code: `revision-${unitId}`,
        name: "Revision integration",
        timezone: "Asia/Shanghai",
      },
    });
    await owner.qualificationType.create({
      data: {
        id: typeId,
        code: `revision-${typeId}`,
        name: "Revision integration",
        validityRule: snapshot.validityRule,
        reminders: snapshot.reminders,
        parameterRestriction: snapshot.parameterRestriction,
        ocrChecks: snapshot.ocrChecks,
      },
    });
  }, 15000);
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(runtime);
    mocks.getAdmin.mockResolvedValue(admin);
  });
  afterAll(async () => {
    try {
      if (owner && pilotIds.length) {
        const requests = await owner.qualificationUpdateRequest.findMany({
          where: { pilotId: { in: pilotIds } },
          select: { id: true },
        });
        const records = await owner.qualificationRecord.findMany({
          where: { pilotId: { in: pilotIds } },
          select: { id: true },
        });
        const recordIds = records.map((record) => record.id);
        await owner.$transaction(async (tx) => {
          // The migrated database deliberately makes audit rows append-only.
          // Only this owner cleanup transaction bypasses triggers; every DELETE
          // remains confined to this suite's UUIDs, and SET LOCAL ends at commit.
          await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
          await tx.qualificationEvidence.deleteMany({
            where: {
              OR: [
                { qualificationRecordId: { in: recordIds } },
                { updateRequestId: { in: requests.map((request) => request.id) } },
              ],
            },
          });
          await tx.qualificationCorrection.deleteMany({
            where: { qualificationRecordId: { in: recordIds } },
          });
          await tx.qualificationUpdateRequest.deleteMany({ where: { pilotId: { in: pilotIds } } });
          await tx.qualificationRecord.updateMany({
            where: { id: { in: recordIds } },
            data: { supersedesRecordId: null, restoresRecordId: null },
          });
          await tx.qualificationRecord.deleteMany({ where: { id: { in: recordIds } } });
          await tx.evidenceImage.deleteMany({ where: { pilotId: { in: pilotIds } } });
          await tx.auditEvent.deleteMany({ where: { pilotId: { in: pilotIds } } });
          await tx.pilot.deleteMany({ where: { id: { in: pilotIds } } });
        });
      }
      if (owner) {
        await owner.qualificationType.deleteMany({ where: { id: typeId } });
        await owner.organizationUnit.deleteMany({ where: { id: unitId } });
      }
    } finally {
      await Promise.allSettled([owner?.$disconnect(), runtime?.$disconnect()]);
    }
  }, 15000);

  async function pilot() {
    const id = randomUUID();
    pilotIds.push(id);
    return owner.pilot.create({
      data: {
        id,
        employeeNumber: `revision-${id}`,
        mobile: "13800000000",
        displayName: "Revision fixture",
        initials: "RF",
        roleCode: "CAPTAIN",
        aircraftType: "A320",
        rankLabel: "CAPTAIN",
        unitId,
      },
    });
  }
  async function record(
    pilotId: string,
    overrides: Partial<Prisma.QualificationRecordUncheckedCreateInput> = {},
  ) {
    return owner.qualificationRecord.create({
      data: { ...fields, pilotId, qualificationTypeId: typeId, ...overrides },
    });
  }
  async function image(pilotId: string) {
    return owner.evidenceImage.create({
      data: {
        pilotId,
        objectKey: `integration/${randomUUID()}.png`,
        mimeType: "image/png",
        width: 1,
        height: 1,
        byteSize: 1,
        sha256: "0".repeat(64),
        status: "linked",
        expiresAt: new Date("2030-01-01T00:00:00Z"),
      },
    });
  }
  async function submission(
    pilotId: string,
    baseline: { id: string; version: number } | null,
    captured = true,
  ) {
    const request = await owner.qualificationUpdateRequest.create({
      data: {
        ...fields,
        pilotId,
        qualificationTypeId: typeId,
        submittedFields: {},
        expectedQualificationRecordId: baseline?.id ?? null,
        expectedVersion: baseline?.version ?? 0,
        baselineCapturedAt: captured ? new Date() : null,
      },
    });
    const evidence = await image(pilotId);
    await owner.qualificationEvidence.create({
      data: { updateRequestId: request.id, evidenceImageId: evidence.id },
    });
    return { request, image: evidence };
  }
  async function restore(current: { id: string; version: number }, targetId: string) {
    const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
    return rollback(
      new NextRequest(`${origin}/api/admin/qualification-records/${current.id}/rollback`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          targetRevisionId: targetId,
          expectedCurrentRevisionId: current.id,
          expectedVersion: current.version,
          reason: "Restore independently checked integration history",
        }),
      }),
      { params: Promise.resolve({ recordId: current.id }) },
    );
  }

  it("uses the complete migration's reusable evidence links with pair-level uniqueness", async () => {
    const p = await pilot();
    const first = await record(p.id, { status: "REPLACED" });
    const second = await record(p.id);
    const evidence = await image(p.id);
    await runtime.qualificationEvidence.create({
      data: { evidenceImageId: evidence.id, qualificationRecordId: first.id },
    });
    await runtime.qualificationEvidence.create({
      data: { evidenceImageId: evidence.id, qualificationRecordId: second.id },
    });
    await expect(
      runtime.qualificationEvidence.create({
        data: { evidenceImageId: evidence.id, qualificationRecordId: second.id },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(
      await owner.qualificationEvidence.count({ where: { evidenceImageId: evidence.id } }),
    ).toBe(2);
    const pending = await submission(p.id, second);
    await runtime.qualificationEvidence.create({
      data: { evidenceImageId: evidence.id, updateRequestId: pending.request.id },
    });
    await expect(
      runtime.qualificationEvidence.create({
        data: { evidenceImageId: evidence.id, updateRequestId: pending.request.id },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(
      await owner.qualificationEvidence.count({ where: { evidenceImageId: evidence.id } }),
    ).toBe(3);
  });

  it("rolls back with evidence, increments version, and rejects the prior submission baseline", async () => {
    const p = await pilot();
    const historical = await record(p.id, { status: "REPLACED", version: 2, revisionNumber: 1 });
    const current = await record(p.id, {
      lineageId: historical.lineageId,
      supersedesRecordId: historical.id,
      revisionNumber: 2,
      version: 7,
    });
    const evidence = await image(p.id);
    await owner.qualificationEvidence.create({
      data: { evidenceImageId: evidence.id, qualificationRecordId: historical.id },
    });
    const pending = await submission(p.id, current);
    const response = await restore(current, historical.id);
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const restored = (await response.json()).data;
    expect(restored).toMatchObject({
      version: 8,
      revisionNumber: 3,
      restoresRecordId: historical.id,
      supersedesRecordId: current.id,
      qualificationRuleSnapshot: snapshot,
    });
    expect(
      await owner.qualificationEvidence.count({ where: { evidenceImageId: evidence.id } }),
    ).toBe(2);
    expect(
      await owner.qualificationEvidence.findFirst({
        where: { evidenceImageId: evidence.id, qualificationRecordId: historical.id },
      }),
    ).not.toBeNull();
    expect(
      await owner.qualificationEvidence.findFirst({
        where: { evidenceImageId: evidence.id, qualificationRecordId: restored.id },
      }),
    ).not.toBeNull();
    await expect(
      approveReview(admin, pending.request.id, { expectedVersion: 1, requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "QUALIFICATION_CHANGED_SINCE_SUBMISSION" });
    expect(
      await owner.qualificationUpdateRequest.findUnique({ where: { id: pending.request.id } }),
    ).toMatchObject({ status: "PENDING", version: 1, qualificationRecordId: null });
    expect(await owner.evidenceImage.findUnique({ where: { id: pending.image.id } })).toMatchObject(
      { status: "linked" },
    );
    expect(
      await owner.qualificationRecord.count({ where: { pilotId: p.id, status: "ACTIVE" } }),
    ).toBe(1);
    expect(
      await owner.qualificationRecord.findFirst({ where: { pilotId: p.id, status: "ACTIVE" } }),
    ).toMatchObject({ id: restored.id, version: 8 });
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("rejects a different record ID even when historical versions are equal (ABA)", async () => {
    const p = await pilot();
    const old = await record(p.id, { status: "REPLACED", version: 1 });
    const current = await record(p.id, {
      lineageId: old.lineageId,
      revisionNumber: 2,
      supersedesRecordId: old.id,
      version: 1,
    });
    const pending = await submission(p.id, old);
    await expect(
      approveReview(admin, pending.request.id, { expectedVersion: 1, requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "QUALIFICATION_CHANGED_SINCE_SUBMISSION" });
    expect(await owner.qualificationRecord.findUnique({ where: { id: current.id } })).toMatchObject(
      { status: "ACTIVE", version: 1 },
    );
    expect(
      await owner.qualificationUpdateRequest.findUnique({ where: { id: pending.request.id } }),
    ).toMatchObject({ status: "PENDING", version: 1 });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("allows exactly one concurrent first approval with no partial loser writes", async () => {
    const p = await pilot();
    const pending = await submission(p.id, null);
    let arrived = 0;
    let release!: () => void;
    let rejectGate!: (error: Error) => void;
    const gate = new Promise<void>((resolve, reject) => {
      release = resolve;
      rejectGate = reject;
    });
    const barrierTimeout = setTimeout(
      () => rejectGate(new Error("Both concurrent approval reads did not reach the barrier")),
      4000,
    );
    // Synchronize AFTER both real database reads. Every write and transaction
    // below is the actual Prisma implementation, including row locks and CAS.
    const racing = runtime.$extends({
      query: {
        qualificationUpdateRequest: {
          async findFirst({ args, query }) {
            const result = await query(args);
            if (args.where?.id === pending.request.id) {
              arrived += 1;
              if (arrived === 2) {
                clearTimeout(barrierTimeout);
                release();
              }
              await gate;
            }
            return result;
          },
        },
      },
    });
    mocks.getPrisma.mockReturnValue(racing);
    const results = await Promise.allSettled([
      approveReview(admin, pending.request.id, { expectedVersion: 1, requestId: randomUUID() }),
      approveReview({ ...admin, id: randomUUID() }, pending.request.id, {
        expectedVersion: 1,
        requestId: randomUUID(),
      }),
    ]);
    expect(arrived).toBe(2);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "VERSION_CONFLICT" });
    const active = await owner.qualificationRecord.findMany({ where: { pilotId: p.id } });
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ status: "ACTIVE", version: 1 });
    expect(
      await owner.qualificationUpdateRequest.findUnique({ where: { id: pending.request.id } }),
    ).toMatchObject({ status: "APPROVED", version: 3, qualificationRecordId: active[0]!.id });
    expect(
      await owner.qualificationEvidence.findMany({ where: { evidenceImageId: pending.image.id } }),
    ).toEqual([
      expect.objectContaining({
        qualificationRecordId: active[0]!.id,
        updateRequestId: pending.request.id,
      }),
    ]);
    expect(
      await owner.auditEvent.count({ where: { pilotId: p.id, action: "qualification.approved" } }),
    ).toBe(1);
    expect(await owner.evidenceImage.findUnique({ where: { id: pending.image.id } })).toMatchObject(
      { status: "retained" },
    );
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  }, 15000);

  it("rejects an uncaptured legacy baseline instead of treating it as a first record", async () => {
    const p = await pilot();
    const pending = await submission(p.id, null, false);
    await expect(
      approveReview(admin, pending.request.id, { expectedVersion: 1, requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "QUALIFICATION_BASELINE_REQUIRES_RESUBMISSION" });
    expect(await owner.qualificationRecord.count({ where: { pilotId: p.id } })).toBe(0);
    expect(
      await owner.qualificationUpdateRequest.findUnique({ where: { id: pending.request.id } }),
    ).toMatchObject({ status: "PENDING", version: 1 });
    expect(
      await owner.qualificationEvidence.findFirst({
        where: { updateRequestId: pending.request.id },
      }),
    ).toMatchObject({ qualificationRecordId: null });
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
