// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { expect, it } from "vitest";
import { collectQualificationAudit } from "../../scripts/audit-qualification-state";

const url = process.env.CREWQUAL_AUDIT_TEST_DATABASE_URL;
it.skipIf(!url)(
  "audits isolated PostgreSQL fixtures without changing them",
  async () => {
    const db = new PrismaClient({ adapter: new PrismaPg(url!) });
    const ids = Object.fromEntries(
      [
        "org",
        "unit",
        "person",
        "pilot",
        "type",
        "definition",
        "assignment",
        "record",
        "request",
      ].map((key) => [key, randomUUID()]),
    );
    try {
      await db.$transaction(async (tx) => {
        await tx.organization.create({
          data: { id: ids.org, code: ids.org!, name: "audit fixture" },
        });
        await tx.organizationUnit.create({
          data: {
            id: ids.unit,
            organizationId: ids.org,
            code: ids.unit!,
            name: "audit fixture",
            timezone: "invalid",
          },
        });
        await tx.person.create({
          data: {
            id: ids.person,
            organizationId: ids.org!,
            unitId: ids.unit,
            employeeNumber: ids.person!,
            mobile: "",
            displayName: "audit fixture",
            initials: "T",
          },
        });
        await tx.pilot.create({
          data: {
            id: ids.pilot,
            personId: ids.person,
            unitId: ids.unit!,
            employeeNumber: ids.pilot!,
            mobile: "",
            displayName: "audit fixture",
            initials: "T",
            roleCode: "CAPTAIN",
            aircraftType: "test",
            rankLabel: "test",
          },
        });
        await tx.qualificationType.create({
          data: {
            id: ids.type,
            code: ids.type!,
            name: "audit fixture",
            validityRule: { kind: "manual_expiry" },
            reminders: {},
            ocrChecks: {},
            parameterRestriction: {},
          },
        });
        await tx.qualificationDefinition.create({
          data: {
            id: ids.definition,
            organizationId: ids.org!,
            code: ids.definition!,
            name: "audit fixture",
            validityRule: { kind: "manual_expiry" },
            reminders: {},
            ocrChecks: {},
            parameterRestriction: {},
          },
        });
        await tx.qualificationAssignment.create({
          data: {
            id: ids.assignment,
            personId: ids.person!,
            qualificationDefinitionId: ids.definition!,
            source: "MANUAL",
          },
        });
        const fields = {
          pilotId: ids.pilot!,
          qualificationTypeId: ids.type!,
          credentialNumber: "sensitive-fixture-value",
          issueDate: new Date("2026-01-01"),
          issuingAuthority: "test",
          levelOrParameter: "test",
          qualificationRuleSnapshot: {
            version: 1,
            snapshotSource: "inferred_backfill",
            validityRule: { kind: "non_expiring" },
          },
        };
        await tx.qualificationRecord.create({ data: { id: ids.record, ...fields } });
        await tx.qualificationUpdateRequest.create({
          data: { id: ids.request, ...fields, submittedFields: {} },
        });
      });
      const before = await db.qualificationRecord.findUniqueOrThrow({ where: { id: ids.record } });
      const report = await collectQualificationAudit(db, new Date("2026-09-07T16:00:00Z"));
      const group = report.groups.find((entry) => entry.organizationId === ids.org);
      expect(group?.counts).toMatchObject({
        required_missing: 1,
        timezone_conflict: 2,
        incomplete: 1,
        unverified_snapshot: 1,
        legacy_pending_baseline: 1,
        canonical_link: 2,
      });
      expect(JSON.stringify(report)).not.toContain("sensitive-fixture-value");
      expect(await db.qualificationRecord.findUniqueOrThrow({ where: { id: ids.record } })).toEqual(
        before,
      );
    } finally {
      // Delete only this invocation's UUIDs; never reset shared fixture tables.
      await db.qualificationUpdateRequest.deleteMany({ where: { id: ids.request } });
      await db.qualificationRecord.deleteMany({ where: { id: ids.record } });
      await db.qualificationAssignment.deleteMany({ where: { id: ids.assignment } });
      await db.qualificationDefinition.deleteMany({ where: { id: ids.definition } });
      await db.qualificationType.deleteMany({ where: { id: ids.type } });
      await db.pilot.deleteMany({ where: { id: ids.pilot } });
      await db.person.deleteMany({ where: { id: ids.person } });
      await db.organizationUnit.deleteMany({ where: { id: ids.unit } });
      await db.organization.deleteMany({ where: { id: ids.org } });
      await db.$disconnect();
    }
  },
  30_000,
);
