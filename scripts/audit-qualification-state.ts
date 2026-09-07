import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { evaluateStoredQualification } from "../src/lib/qualification-date-status";
import { qualificationValiditySnapshotSchema } from "../src/lib/qualification-rules";
import { pilotQualificationTimezone } from "../src/lib/qualification-timezone";
import {
  qualificationPersonInclude,
  resolveMemberQualifications,
  type QualificationPerson,
} from "../src/server/member-qualifications";

export type AuditFinding = {
  category:
    | "required_missing"
    | "incomplete"
    | "timezone_conflict"
    | "unverified_snapshot"
    | "legacy_pending_baseline"
    | "duplicate_active"
    | "canonical_link"
    | "duplicate_evidence_pair";
  organizationId: string | null;
  personId: string | null;
  definitionId: string | null;
  recordId: string | null;
  entityId: string;
  reason: string;
};

export function auditMemberRequirements(people: QualificationPerson[], now: Date): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const person of people) {
    const projection = resolveMemberQualifications(
      person,
      { now: () => now },
      { observeCompatibility: false },
    );
    const owner = {
      organizationId: person.organizationId,
      personId: person.id,
      definitionId: null,
      recordId: null,
      entityId: person.id,
    };
    if (!projection.timezone)
      findings.push({
        ...owner,
        category: "timezone_conflict",
        reason: "invalid_missing_or_conflicting_owner_timezone",
      });
    for (const item of projection.items) {
      if (item.required && item.state.status === "missing")
        findings.push({
          ...owner,
          definitionId: item.definition.id,
          category: "required_missing",
          reason: "effective_required_assignment_without_record",
        });
    }
  }
  return findings;
}

export function summarizeFindings(findings: AuditFinding[], now: Date) {
  const unique = [
    ...new Map(findings.map((finding) => [JSON.stringify(finding), finding])).values(),
  ];
  unique.sort((a, b) =>
    [a.organizationId, a.personId, a.definitionId, a.recordId, a.category, a.reason, a.entityId]
      .join("/")
      .localeCompare(
        [
          b.organizationId,
          b.personId,
          b.definitionId,
          b.recordId,
          b.category,
          b.reason,
          b.entityId,
        ].join("/"),
      ),
  );
  const byOrganization = new Map<
    string,
    { organizationId: string | null; counts: Record<string, number>; findings: AuditFinding[] }
  >();
  for (const finding of unique) {
    const key = finding.organizationId ?? "unresolved";
    const group = byOrganization.get(key) ?? {
      organizationId: finding.organizationId,
      counts: {},
      findings: [],
    };
    group.counts[finding.category] = (group.counts[finding.category] ?? 0) + 1;
    group.findings.push(finding);
    byOrganization.set(key, group);
  }
  return {
    event: "qualification_state_audit",
    dryRun: true,
    evaluatedAt: now.toISOString(),
    findingCount: unique.length,
    groups: [...byOrganization.values()],
  };
}

/** Runs in one consistent, database-enforced read-only snapshot. Never loads .env. */
export async function collectQualificationAudit(prisma: PrismaClient, now = new Date()) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const people = await tx.person.findMany({ include: qualificationPersonInclude });
      const findings = auditMemberRequirements(people, now);
      const records = await tx.qualificationRecord.findMany({
        select: {
          id: true,
          personId: true,
          qualificationDefinitionId: true,
          expiryDate: true,
          qualificationRuleSnapshot: true,
          pilot: {
            select: {
              unitId: true,
              unit: { select: { id: true, timezone: true, organizationId: true } },
              person: {
                select: {
                  organizationId: true,
                  unitId: true,
                  unit: { select: { id: true, timezone: true, organizationId: true } },
                },
              },
            },
          },
          person: { select: { organizationId: true } },
        },
      });
      for (const record of records) {
        const owner = {
          organizationId: record.person?.organizationId ?? record.pilot.unit.organizationId,
          personId: record.personId,
          definitionId: record.qualificationDefinitionId,
          recordId: record.id,
          entityId: record.id,
        };
        const timezone = pilotQualificationTimezone(record.pilot);
        const state = evaluateStoredQualification(record, { now: () => now }, timezone);
        if (!timezone)
          findings.push({
            ...owner,
            category: "timezone_conflict",
            reason: "invalid_missing_or_conflicting_owner_timezone",
          });
        if (state.status === "incomplete")
          findings.push({
            ...owner,
            category: "incomplete",
            reason: state.statusReason ?? "unknown_rule_or_date",
          });
        const snapshot = qualificationValiditySnapshotSchema.safeParse(
          record.qualificationRuleSnapshot,
        );
        if (!snapshot.success || snapshot.data.snapshotSource === "inferred_backfill")
          findings.push({
            ...owner,
            category: "unverified_snapshot",
            reason: snapshot.success ? "inferred_backfill" : "invalid_or_missing_snapshot",
          });
      }
      const structural = await tx.$queryRaw<AuditFinding[]>(Prisma.sql`
      WITH entities AS (
        SELECT 'record' AS kind, r.id, r."personId", r."qualificationDefinitionId", r."qualificationTypeId", r."pilotId", r.id AS "recordId" FROM "QualificationRecord" r
        UNION ALL SELECT 'request', r.id, r."personId", r."qualificationDefinitionId", r."qualificationTypeId", r."pilotId", NULL::uuid FROM "QualificationUpdateRequest" r
      ), linked AS (
        SELECT e.*, COALESCE(p."organizationId", u."organizationId") AS "organizationId", pilot."personId" AS "pilotPersonId", d."organizationId" AS "definitionOrg", d."legacyQualificationTypeId"
        FROM entities e LEFT JOIN "Person" p ON p.id = e."personId"
        JOIN "Pilot" pilot ON pilot.id = e."pilotId" JOIN "OrganizationUnit" u ON u.id = pilot."unitId"
        LEFT JOIN "QualificationDefinition" d ON d.id = e."qualificationDefinitionId"
      )
      SELECT 'canonical_link' AS category, "organizationId", "personId", "qualificationDefinitionId" AS "definitionId", "recordId", id AS "entityId", kind || '_missing_or_inconsistent_canonical_link' AS reason FROM linked
      WHERE "personId" IS NULL OR "qualificationDefinitionId" IS NULL OR "personId" IS DISTINCT FROM "pilotPersonId" OR "organizationId" IS DISTINCT FROM "definitionOrg" OR "legacyQualificationTypeId" IS DISTINCT FROM "qualificationTypeId"
      UNION ALL
      SELECT 'legacy_pending_baseline', COALESCE(p."organizationId", u."organizationId"), r."personId", r."qualificationDefinitionId", NULL::uuid, r.id, 'pending_without_captured_baseline'
      FROM "QualificationUpdateRequest" r LEFT JOIN "Person" p ON p.id = r."personId" JOIN "Pilot" pilot ON pilot.id = r."pilotId" JOIN "OrganizationUnit" u ON u.id = pilot."unitId"
      WHERE r.status = 'PENDING' AND r."baselineCapturedAt" IS NULL
      UNION ALL
      SELECT 'canonical_link', u."organizationId", pilot."personId", NULL::uuid, NULL::uuid, pilot.id, 'pilot_missing_person'
      FROM "Pilot" pilot JOIN "OrganizationUnit" u ON u.id = pilot."unitId" WHERE pilot."personId" IS NULL
      UNION ALL
      SELECT 'canonical_link', p."organizationId", p.id, NULL::uuid, NULL::uuid, p.id, 'person_unit_organization_mismatch'
      FROM "Person" p JOIN "OrganizationUnit" u ON u.id = p."unitId" WHERE p."organizationId" IS DISTINCT FROM u."organizationId"
      UNION ALL
      SELECT 'canonical_link', COALESCE(p."organizationId", u."organizationId"), plan."personId", NULL::uuid, NULL::uuid, plan.id, 'plan_missing_or_inconsistent_canonical_link'
      FROM "UpgradePlan" plan LEFT JOIN "Person" p ON p.id = plan."personId" JOIN "Pilot" pilot ON pilot.id = plan."pilotId" JOIN "OrganizationUnit" u ON u.id = pilot."unitId" LEFT JOIN "PersonPositionAssignment" a ON a.id = plan."positionAssignmentId"
      WHERE plan."personId" IS NULL OR plan."positionAssignmentId" IS NULL OR plan."personId" IS DISTINCT FROM pilot."personId" OR a."personId" IS DISTINCT FROM plan."personId"
      UNION ALL
      SELECT 'duplicate_active', COALESCE(p."organizationId", u."organizationId"), r."personId", r."qualificationDefinitionId", r.id, r.id, 'multiple_active_records_for_canonical_or_legacy_owner'
      FROM "QualificationRecord" r LEFT JOIN "Person" p ON p.id = r."personId" JOIN "Pilot" pilot ON pilot.id = r."pilotId" JOIN "OrganizationUnit" u ON u.id = pilot."unitId"
      WHERE r.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM "QualificationRecord" other WHERE other.status = 'ACTIVE' AND other.id <> r.id AND ((other."personId" = r."personId" AND other."qualificationDefinitionId" = r."qualificationDefinitionId") OR (other."pilotId" = r."pilotId" AND other."qualificationTypeId" = r."qualificationTypeId")))
      UNION ALL
      SELECT 'duplicate_evidence_pair', l."organizationId", l."personId", l."qualificationDefinitionId", l."recordId", e.id, 'duplicate_image_' || l.kind || '_pair'
      FROM "QualificationEvidence" e JOIN linked l ON (l.kind = 'record' AND l.id = e."qualificationRecordId") OR (l.kind = 'request' AND l.id = e."updateRequestId")
      WHERE EXISTS (SELECT 1 FROM "QualificationEvidence" other WHERE other.id <> e.id AND other."evidenceImageId" = e."evidenceImageId" AND ((l.kind = 'record' AND other."qualificationRecordId" = e."qualificationRecordId") OR (l.kind = 'request' AND other."updateRequestId" = e."updateRequestId")))
    `);
      return summarizeFindings([...findings, ...structural], now);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120_000 },
  );
}

export async function runQualificationAudit(gate: "report" | "compatibility") {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Explicit DIRECT_URL or DATABASE_URL is required");
  const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });
  try {
    const report = await collectQualificationAudit(prisma);
    console.log(JSON.stringify({ ...report, gate }, null, 2));
    if (gate === "compatibility" && report.findingCount > 0) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dry-run" && arg !== "--gate=compatibility")) {
    console.error("Usage: audit-qualification-state.ts [--dry-run] [--gate=compatibility]");
    process.exitCode = 1;
  } else {
    void runQualificationAudit(
      args.includes("--gate=compatibility") ? "compatibility" : "report",
    ).catch(() => {
      console.error(
        "qualification_state_audit_failed: unable to complete read-only audit; details suppressed to protect connection and record data",
      );
      process.exitCode = 1;
    });
  }
}
