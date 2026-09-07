import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMember, listMembers } from "@/server/member-repository";
import type { AuthenticatedAdmin } from "@/server/auth";

const mocks = vi.hoisted(() => ({ count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() }));
vi.mock("@/server/prisma", () => ({ getPrisma: () => ({ person: mocks }) }));
const admin = {
  roles: ["UNIT_ADMIN"],
  organizationId: "org-1",
  unitId: "unit-1",
} as AuthenticatedAdmin;
const clock = { now: () => new Date("2026-09-07T04:00:00Z") };

function assignment(id: string, required: boolean) {
  return {
    id,
    active: true,
    qualificationDefinitionId: "definition-1",
    requirementId: `requirement-${id}`,
    qualificationDefinition: {
      id: "definition-1",
      active: true,
      code: "CERT",
      name: "Certificate",
      legacyQualificationTypeId: "type-1",
    },
    requirement: { required, active: true, position: { active: true, code: id, name: id } },
    positionAssignment: null,
    source: "POSITION",
    createdAt: new Date("2026-01-01"),
  };
}

function snapshot(kind: "manual_expiry" | "non_expiring" = "manual_expiry") {
  return {
    version: 1,
    snapshotSource: "captured",
    validityRule: { kind },
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

function person() {
  return {
    id: "person-1",
    organizationId: "org-1",
    unitId: "unit-1",
    unit: { id: "unit-1", organizationId: "org-1", timezone: "Asia/Shanghai" },
    positionAssignments: [],
    pilotProfile: null,
    qualificationAssignments: [assignment("a-1", true)],
    qualificationRecords: [] as Array<Record<string, unknown>>,
    legacyPilot: null as null | { unitId: string; qualifications: Array<Record<string, unknown>> },
  };
}

describe("member qualification correctness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.count.mockResolvedValue(1);
  });
  it("does not report a missing required record as healthy and scopes list reads", async () => {
    mocks.findMany.mockResolvedValue([person()]);
    const result = await listMembers(admin, {}, clock);
    expect(result.items[0]).toMatchObject({
      health: "missing",
      qualificationCounts: { missing: 1, valid: 0 },
      qualifications: [{ status: "missing", record: null }],
    });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1", unitId: "unit-1" } }),
    );
  });
  it.each([
    ["non_expiring", null, "valid"],
    ["manual_expiry", null, "incomplete"],
    ["manual_expiry", new Date("2026-09-07T00:00:00Z"), "due"],
  ] as const)(
    "evaluates %s and %s identically for list and detail",
    async (kind, expiryDate, health) => {
      const input = person();
      input.qualificationRecords = [
        {
          id: "record-1",
          qualificationDefinitionId: "definition-1",
          expiryDate,
          qualificationRuleSnapshot: snapshot(kind),
        },
      ];
      mocks.findMany.mockResolvedValue([input]);
      mocks.findFirst.mockResolvedValue(input);
      const listed = (await listMembers(admin, {}, clock)).items[0];
      const detail = await getMember(admin, input.id, clock);
      expect(detail).toEqual(listed);
      expect(detail.health).toBe(health);
    },
  );
  it("merges required requirements without depending on assignment order", async () => {
    const input = person();
    input.qualificationAssignments = [assignment("optional", false), assignment("required", true)];
    for (const entries of [
      input.qualificationAssignments,
      [...input.qualificationAssignments].reverse(),
    ]) {
      mocks.findMany.mockResolvedValue([{ ...input, qualificationAssignments: entries }]);
      const result = (await listMembers(admin, {}, clock)).items[0]!;
      expect(result.health).toBe("missing");
      expect(result.qualifications).toHaveLength(1);
      expect(result.qualifications[0]).toMatchObject({
        required: true,
        sources: expect.any(Array),
      });
      expect(result.qualifications[0]!.sources).toHaveLength(2);
    }
  });
  it("keeps optional missing visible and distinguishes unconfigured", async () => {
    const input = person();
    input.qualificationAssignments = [assignment("optional", false)];
    mocks.findMany.mockResolvedValue([input]);
    expect((await listMembers(admin, {}, clock)).items[0]).toMatchObject({
      health: "valid",
      qualificationCounts: { missing: 1 },
      requiredQualificationCounts: { missing: 0 },
    });
    input.qualificationAssignments = [];
    mocks.findMany.mockResolvedValue([input]);
    expect((await listMembers(admin, {}, clock)).items[0]?.health).toBe("unconfigured");
  });
  it("uses the same rules for legacy fallback and flags conflicting holder units", async () => {
    const input = person();
    input.legacyPilot = {
      unitId: "unit-1",
      qualifications: [
        {
          id: "legacy-1",
          qualificationTypeId: "type-1",
          qualificationType: { code: "CERT" },
          expiryDate: null,
          qualificationRuleSnapshot: snapshot("non_expiring"),
        },
      ],
    };
    mocks.findMany.mockResolvedValue([input]);
    expect((await listMembers(admin, {}, clock)).items[0]).toMatchObject({
      health: "valid",
      qualifications: [{ recordSource: "legacy" }],
    });
    input.legacyPilot.unitId = "unit-2";
    expect((await listMembers(admin, {}, clock)).items[0]).toMatchObject({
      health: "incomplete",
      timezone: null,
    });
  });
});
