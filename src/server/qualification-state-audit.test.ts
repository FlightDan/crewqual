import { describe, expect, it, vi } from "vitest";
import {
  auditMemberRequirements,
  collectQualificationAudit,
  summarizeFindings,
} from "../../scripts/audit-qualification-state";
import type { QualificationPerson } from "./member-qualifications";

const now = new Date("2026-09-07T16:00:00Z");
const owner = {
  organizationId: "org",
  personId: "person",
  definitionId: "definition",
  recordId: "record",
  entityId: "record",
};

describe("qualification dry-run audit", () => {
  it("finds required missing from assignments even without any records, merging optional sources", () => {
    const person = {
      id: "person",
      organizationId: "org",
      unitId: "unit",
      unit: { id: "unit", organizationId: "org", timezone: "Asia/Shanghai" },
      legacyPilot: null,
      qualificationRecords: [],
      qualificationAssignments: [false, true].map((required, index) => ({
        id: String(index),
        active: true,
        qualificationDefinitionId: "definition",
        qualificationDefinition: { id: "definition", active: true },
        requirement: { active: true, required, position: { active: true } },
        positionAssignment: null,
      })),
    } as unknown as QualificationPerson;
    expect(auditMemberRequirements([person], now)).toEqual([
      {
        ...owner,
        recordId: null,
        entityId: "person",
        category: "required_missing",
        reason: "effective_required_assignment_without_record",
      },
    ]);
    person.qualificationAssignments.forEach((a) => {
      a.requirement!.required = false;
    });
    expect(auditMemberRequirements([person], now)).toEqual([]);
    person.unit!.timezone = "invalid";
    expect(auditMemberRequirements([person], now)[0]?.category).toBe("timezone_conflict");
  });

  it("does not count dry-run legacy fallback as live compatibility traffic", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const person = {
      id: "person",
      organizationId: "org",
      unitId: "unit",
      unit: { id: "unit", organizationId: "org", timezone: "UTC" },
      qualificationRecords: [],
      qualificationAssignments: [
        {
          active: true,
          qualificationDefinitionId: "definition",
          qualificationDefinition: {
            id: "definition",
            code: "medical",
            active: true,
            legacyQualificationTypeId: "type",
          },
          requirement: null,
          positionAssignment: null,
        },
      ],
      legacyPilot: {
        unitId: "unit",
        qualifications: [
          {
            id: "legacy-record",
            personId: null,
            qualificationDefinitionId: null,
            qualificationTypeId: "type",
            qualificationType: { code: "medical" },
            expiryDate: null,
            qualificationRuleSnapshot: {
              version: 1,
              snapshotSource: "captured",
              validityRule: { kind: "non_expiring" },
            },
          },
        ],
      },
    } as unknown as QualificationPerson;
    try {
      expect(auditMemberRequirements([person], now)).toEqual([]);
      expect(info).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
    }
  });

  it("uses shared snapshot/date classification and enforces a read-only consistent transaction", async () => {
    const tx = {
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      person: { findMany: vi.fn().mockResolvedValue([]) },
      qualificationRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "record",
            personId: "person",
            qualificationDefinitionId: "definition",
            expiryDate: null,
            qualificationRuleSnapshot: {
              version: 1,
              snapshotSource: "inferred_backfill",
              validityRule: { kind: "non_expiring" },
            },
            credentialNumber: "SECRET_CERTIFICATE",
            person: { organizationId: "org" },
            pilot: {
              unitId: "unit",
              unit: { id: "unit", organizationId: "org", timezone: "Asia/Shanghai" },
              person: null,
            },
          },
        ]),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(tx)),
    };
    const report = await collectQualificationAudit(prisma as never, now);
    expect(tx.$executeRaw.mock.calls[0]?.[0].join("")).toBe("SET TRANSACTION READ ONLY");
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
      timeout: 120000,
    });
    expect(report.groups[0]?.counts).toEqual({ incomplete: 1, unverified_snapshot: 1 });
    expect(JSON.stringify(report)).not.toContain("SECRET_CERTIFICATE");
    expect(JSON.stringify(report)).not.toContain("qualificationRuleSnapshot");
  });

  it("groups by organization and deduplicates deterministic findings", () => {
    const finding = {
      ...owner,
      category: "legacy_pending_baseline" as const,
      reason: "pending_without_captured_baseline",
    };
    const report = summarizeFindings([finding, finding], now);
    expect(report.findingCount).toBe(1);
    expect(report.groups[0]?.counts).toEqual({ legacy_pending_baseline: 1 });
    expect(report.dryRun).toBe(true);
  });
});
