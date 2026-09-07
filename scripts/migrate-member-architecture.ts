import { loadEnvConfig } from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { CORE_QUALIFICATION_CATALOG } from "../src/types/services";
import { PILOT_TEMPLATE_PACK, templatePackChecksum } from "../src/server/template-packs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

loadEnvConfig(process.cwd());

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_URL or DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });

type MigrationSummary = {
  organizations: number;
  people: number;
  pilotProfiles: number;
  positions: number;
  definitions: number;
  requirements: number;
  positionAssignments: number;
  qualificationAssignments: number;
  recordsLinked: number;
  requestsLinked: number;
  plansLinked: number;
};

function emptySummary(): MigrationSummary {
  return {
    organizations: 0,
    people: 0,
    pilotProfiles: 0,
    positions: 0,
    definitions: 0,
    requirements: 0,
    positionAssignments: 0,
    qualificationAssignments: 0,
    recordsLinked: 0,
    requestsLinked: 0,
    plansLinked: 0,
  };
}

async function ensureTemplatePack() {
  const checksum = templatePackChecksum(PILOT_TEMPLATE_PACK);
  const existing = await prisma.templatePack.findUnique({
    where: {
      code_version: {
        code: PILOT_TEMPLATE_PACK.code,
        version: PILOT_TEMPLATE_PACK.version,
      },
    },
  });
  if (existing) {
    if (existing.checksum !== checksum) {
      throw new Error("Existing Pilot template has a different checksum");
    }
    return existing;
  }
  return prisma.templatePack.create({
    data: {
      code: PILOT_TEMPLATE_PACK.code,
      version: PILOT_TEMPLATE_PACK.version,
      industryCode: PILOT_TEMPLATE_PACK.industryCode,
      name: PILOT_TEMPLATE_PACK.name,
      description: PILOT_TEMPLATE_PACK.description,
      translations: PILOT_TEMPLATE_PACK.translations,
      payload: PILOT_TEMPLATE_PACK as never,
      checksum,
    },
  });
}

async function installPilotPack(
  tx: Prisma.TransactionClient,
  organizationId: string,
  packId: string,
  summary: MigrationSummary,
) {
  const pack = PILOT_TEMPLATE_PACK;
  const positionInput = pack.positions[0]!;
  const existingPosition = await tx.position.findUnique({
    where: { organizationId_code: { organizationId, code: positionInput.code } },
  });
  const position =
    existingPosition ??
    (await tx.position.create({
      data: {
        organizationId,
        code: positionInput.code,
        name: positionInput.name,
        description: positionInput.description,
        translations: positionInput.translations,
        sortOrder: positionInput.sortOrder,
        sourcePackCode: pack.code,
        sourcePackVersion: pack.version,
      },
    }));
  if (!existingPosition) summary.positions += 1;

  const definitions = new Map<string, { id: string }>();
  for (const definitionInput of pack.qualificationDefinitions) {
    const existing = await tx.qualificationDefinition.findUnique({
      where: { organizationId_code: { organizationId, code: definitionInput.code } },
      select: { id: true },
    });
    const definition =
      existing ??
      (await tx.qualificationDefinition.create({
        data: {
          organizationId,
          code: definitionInput.code,
          name: definitionInput.name,
          description: definitionInput.description,
          translations: definitionInput.translations,
          category: definitionInput.category,
          active: definitionInput.active,
          requiresEvidence: definitionInput.requiresEvidence,
          requiresHumanReview: true,
          allowAutoApproval: false,
          fieldSchema: definitionInput.fieldSchema,
          validityRule: definitionInput.validityRule,
          reminders: definitionInput.reminders,
          ocrChecks: definitionInput.ocrChecks,
          parameterRestriction: definitionInput.parameterRestriction,
          sortOrder: definitionInput.sortOrder,
          sourcePackCode: pack.code,
          sourcePackVersion: pack.version,
        },
        select: { id: true },
      }));
    if (!existing) summary.definitions += 1;
    definitions.set(definitionInput.code, definition);
  }

  const requirements = new Map<string, { id: string; qualificationDefinitionId: string }>();
  for (const requirementInput of pack.requirements) {
    const definition = definitions.get(requirementInput.qualificationCode)!;
    const existing = await tx.qualificationRequirement.findUnique({
      where: {
        positionId_qualificationDefinitionId: {
          positionId: position.id,
          qualificationDefinitionId: definition.id,
        },
      },
    });
    const requirement =
      existing ??
      (await tx.qualificationRequirement.create({
        data: {
          positionId: position.id,
          qualificationDefinitionId: definition.id,
          required: requirementInput.required,
          upgradePrerequisite: requirementInput.upgradePrerequisite,
          active: requirementInput.active,
          sortOrder: requirementInput.sortOrder,
          sourcePackCode: pack.code,
          sourcePackVersion: pack.version,
        },
      }));
    if (!existing) summary.requirements += 1;
    requirements.set(requirementInput.qualificationCode, {
      id: requirement.id,
      qualificationDefinitionId: definition.id,
    });
  }

  return { position, definitions, requirements };
}

/**
 * Link mutable legacy projections to their new Person owner.
 *
 * AuditEvent is deliberately excluded: production installs protect it with a
 * database append-only trigger, so historical rows must retain their original
 * immutable shape. They remain addressable through pilotId; new events should
 * set personId when they are created.
 */
export async function linkMutablePilotProjections(
  tx: Prisma.TransactionClient,
  pilotId: string,
  personId: string,
) {
  await tx.evidenceImage.updateMany({
    where: { pilotId },
    data: { personId },
  });
  await tx.notificationDelivery.updateMany({
    where: { pilotId },
    data: { personId },
  });
}

export async function ensureLegacyQualificationDefinitionLink(
  tx: Prisma.TransactionClient,
  definition: { id: string; legacyQualificationTypeId: string | null },
  legacyQualificationTypeId: string,
) {
  if (definition.legacyQualificationTypeId === legacyQualificationTypeId) return definition;
  return tx.qualificationDefinition.update({
    where: { id: definition.id },
    data: { legacyQualificationTypeId },
    select: { id: true, legacyQualificationTypeId: true },
  });
}

type MigrationPilot = Pick<
  Prisma.PilotGetPayload<Record<string, never>>,
  | "id"
  | "personId"
  | "unitId"
  | "employeeNumber"
  | "mobile"
  | "displayName"
  | "initials"
  | "active"
  | "version"
>;

/** Preserve explicit canonical identity; employee-number equality is not authority to relink a person. */
export async function ensureMigrationPerson(
  tx: Prisma.TransactionClient,
  pilot: MigrationPilot,
  organizationId: string,
) {
  const identityConflict = (reason: string): never => {
    throw new Error(`MIGRATION_PERSON_IDENTITY_CONFLICT: pilot ${pilot.id}: ${reason}`);
  };
  // Keep the legacy snapshot stable until the surrounding unit transaction
  // finishes writing PilotProfile and other projections. Admin edits lock this
  // same row and increment version, so stale snapshots cannot overwrite them.
  const [locked] = await tx.$queryRaw<
    Array<Pick<MigrationPilot, "id" | "personId" | "unitId" | "employeeNumber" | "version">>
  >`SELECT id, "personId", "unitId", "employeeNumber", version
      FROM "Pilot" WHERE id = ${pilot.id}::uuid FOR UPDATE`;
  if (
    !locked ||
    locked.personId !== pilot.personId ||
    locked.unitId !== pilot.unitId ||
    locked.employeeNumber !== pilot.employeeNumber ||
    locked.version !== pilot.version
  ) {
    identityConflict("pilot snapshot changed during migration");
  }
  const existing = await tx.person.findUnique({
    where: { id: pilot.personId ?? pilot.id },
    include: { legacyPilot: { select: { id: true } } },
  });
  if (pilot.personId && !existing) identityConflict("linked canonical person is missing");
  if (existing) {
    if (existing.organizationId !== organizationId)
      identityConflict("canonical organization differs from pilot unit organization");
    if (existing.unitId !== pilot.unitId)
      identityConflict("canonical unit differs from pilot unit");
    if (existing.employeeNumber !== pilot.employeeNumber)
      identityConflict("canonical employee number differs from pilot");
    if (existing.legacyPilot && existing.legacyPilot.id !== pilot.id)
      identityConflict("person is already linked to another pilot");
  } else {
    const employeeMatch = await tx.person.findUnique({
      where: { employeeNumber: pilot.employeeNumber },
      select: { id: true },
    });
    if (employeeMatch)
      identityConflict(
        "employee number belongs to a different canonical identity; explicit reconciliation is required",
      );
  }
  // Existing canonical names, contact details, lifecycle and version are not
  // overwritten by a legacy migration rerun.
  const person =
    existing ??
    (await tx.person.create({
      data: {
        id: pilot.id,
        organizationId,
        unitId: pilot.unitId,
        employeeNumber: pilot.employeeNumber,
        mobile: pilot.mobile,
        displayName: pilot.displayName,
        initials: pilot.initials,
        active: pilot.active,
        version: pilot.version,
      },
    }));
  if (!pilot.personId) {
    const linked = await tx.pilot.updateMany({
      where: { id: pilot.id, personId: null },
      data: { personId: person.id },
    });
    if (linked.count !== 1) identityConflict("pilot canonical link changed during migration");
  }
  return person;
}

export async function migrate() {
  const summary = emptySummary();
  const dryRun = process.argv.includes("--dry-run");
  const units = await prisma.organizationUnit.findMany({ orderBy: { code: "asc" } });
  const pilots = await prisma.pilot.findMany({ orderBy: { employeeNumber: "asc" } });
  const qualificationTypes = await prisma.qualificationType.findMany();

  if (dryRun) {
    const [records, requests, plans, existingOrganizations, existingPeople] = await Promise.all([
      prisma.qualificationRecord.count(),
      prisma.qualificationUpdateRequest.count(),
      prisma.upgradePlan.count(),
      prisma.organization.count(),
      prisma.person.count(),
    ]);
    const unitIds = new Set(units.map((unit) => unit.id));
    const orphanPilotUnits = pilots.filter((pilot) => !unitIds.has(pilot.unitId));
    const employeeNumbers = new Map<string, number>();
    for (const pilot of pilots) {
      const key = pilot.employeeNumber.trim().toLowerCase();
      employeeNumbers.set(key, (employeeNumbers.get(key) ?? 0) + 1);
    }
    const duplicateEmployeeNumbers = [...employeeNumbers.entries()]
      .filter(([, count]) => count > 1)
      .map(([employeeNumber]) => employeeNumber);
    const checks = {
      orphanPilotUnits: orphanPilotUnits.map((pilot) => ({ id: pilot.id, unitId: pilot.unitId })),
      duplicateEmployeeNumbers,
      canProceed: orphanPilotUnits.length === 0 && duplicateEmployeeNumbers.length === 0,
    };
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          current: {
            organizationsToCreate: units.length,
            peopleToCreate: pilots.length,
            existingOrganizations,
            existingPeople,
            qualificationTypesToClonePerOrganization: qualificationTypes.length,
            qualificationRecords: records,
            updateRequests: requests,
            upgradePlans: plans,
          },
          template: {
            code: PILOT_TEMPLATE_PACK.code,
            version: PILOT_TEMPLATE_PACK.version,
            qualificationDefinitions: CORE_QUALIFICATION_CATALOG.length,
          },
          checks,
        },
        null,
        2,
      ),
    );
    if (!checks.canProceed) throw new Error("迁移 dry-run 检查未通过，已停止写入");
    return;
  }

  const pack = await ensureTemplatePack();
  for (const unit of units) {
    await prisma.$transaction(async (tx) => {
      const linkedAdmin = unit.organizationId
        ? null
        : await tx.adminUser.findFirst({
            where: { unitId: unit.id, organizationId: { not: null } },
            select: { organizationId: true },
          });
      const linkedOrganizationId = unit.organizationId ?? linkedAdmin?.organizationId ?? null;
      const linkedOrganization = linkedOrganizationId
        ? await tx.organization.findUnique({ where: { id: linkedOrganizationId } })
        : null;
      const organization = linkedOrganization
        ? await tx.organization.update({
            where: { id: linkedOrganization.id },
            data: { name: linkedOrganization.name, active: unit.active },
          })
        : await tx.organization.upsert({
            where: { code: unit.code },
            update: { name: unit.name, active: unit.active },
            create: { code: unit.code, name: unit.name, active: unit.active },
          });
      summary.organizations += 1;
      await tx.organizationUnit.update({
        where: { id: unit.id },
        data: { organizationId: organization.id, parentId: null },
      });
      await tx.adminUser.updateMany({
        where: { unitId: unit.id },
        data: { organizationId: organization.id },
      });

      const installed = await installPilotPack(tx, organization.id, pack.id, summary);
      const pilotPosition = installed.position;

      // Clone every legacy type for the organization, including units that do
      // not currently have a Pilot, so supplemental definitions are not lost.
      const typeMap = new Map<string, { id: string }>();
      for (const type of qualificationTypes) {
        const existing = await tx.qualificationDefinition.findUnique({
          where: { organizationId_code: { organizationId: organization.id, code: type.code } },
          select: { id: true, legacyQualificationTypeId: true },
        });
        const definition = existing
          ? await ensureLegacyQualificationDefinitionLink(tx, existing, type.id)
          : await tx.qualificationDefinition.create({
              data: {
                organizationId: organization.id,
                code: type.code,
                name: type.name,
                translations: type.translations as Prisma.InputJsonValue,
                category: "aviation",
                active: type.active,
                requiresEvidence: true,
                requiresHumanReview: true,
                allowAutoApproval: false,
                fieldSchema: { fields: [] },
                validityRule: type.validityRule as never,
                reminders: type.reminders as never,
                ocrChecks: type.ocrChecks as never,
                parameterRestriction: type.parameterRestriction as never,
                sortOrder: type.core ? 0 : 100,
                legacyQualificationTypeId: type.id,
              },
              select: { id: true, legacyQualificationTypeId: true },
            });
        if (!existing) summary.definitions += 1;
        typeMap.set(type.id, definition);
      }

      for (const pilot of pilots.filter((item) => item.unitId === unit.id)) {
        const person = await ensureMigrationPerson(tx, pilot, organization.id);
        summary.people += 1;
        await tx.pilotProfile.upsert({
          where: { personId: person.id },
          update: {
            legacyPilotId: pilot.id,
            aircraftType: pilot.aircraftType,
            dutyCode: pilot.roleCode,
            rankLabel: pilot.rankLabel,
          },
          create: {
            id: pilot.id,
            personId: person.id,
            legacyPilotId: pilot.id,
            aircraftType: pilot.aircraftType,
            dutyCode: pilot.roleCode,
            rankLabel: pilot.rankLabel,
          },
        });
        summary.pilotProfiles += 1;

        let positionAssignment = await tx.personPositionAssignment.findFirst({
          where: { personId: person.id, positionId: pilotPosition.id, status: "ACTIVE" },
        });
        if (!positionAssignment) {
          positionAssignment = await tx.personPositionAssignment.create({
            data: {
              personId: person.id,
              positionId: pilotPosition.id,
              isPrimary: true,
              effectiveFrom: pilot.createdAt,
            },
          });
          summary.positionAssignments += 1;
        }
        for (const requirement of installed.requirements.values()) {
          const existingAssignment = await tx.qualificationAssignment.findFirst({
            where: {
              personId: person.id,
              positionAssignmentId: positionAssignment.id,
              requirementId: requirement.id,
              active: true,
            },
          });
          if (!existingAssignment) {
            await tx.qualificationAssignment.create({
              data: {
                personId: person.id,
                qualificationDefinitionId: requirement.qualificationDefinitionId,
                requirementId: requirement.id,
                positionAssignmentId: positionAssignment.id,
                source: "POSITION_REQUIREMENT",
              },
            });
            summary.qualificationAssignments += 1;
          }
        }

        const records = await tx.qualificationRecord.findMany({
          where: { pilotId: pilot.id },
          select: { id: true, qualificationTypeId: true },
        });
        for (const record of records) {
          const definition = typeMap.get(record.qualificationTypeId);
          if (!definition) continue;
          await tx.qualificationRecord.update({
            where: { id: record.id },
            data: { personId: person.id, qualificationDefinitionId: definition.id },
          });
          summary.recordsLinked += 1;
          const existingAssignment = await tx.qualificationAssignment.findFirst({
            where: {
              personId: person.id,
              qualificationDefinitionId: definition.id,
              active: true,
            },
          });
          if (!existingAssignment) {
            await tx.qualificationAssignment.create({
              data: {
                personId: person.id,
                qualificationDefinitionId: definition.id,
                source: "LEGACY_RECORD",
              },
            });
            summary.qualificationAssignments += 1;
          }
        }

        const requests = await tx.qualificationUpdateRequest.findMany({
          where: { pilotId: pilot.id },
          select: { id: true, qualificationTypeId: true },
        });
        for (const request of requests) {
          const definition = typeMap.get(request.qualificationTypeId);
          if (!definition) continue;
          await tx.qualificationUpdateRequest.update({
            where: { id: request.id },
            data: { personId: person.id, qualificationDefinitionId: definition.id },
          });
          summary.requestsLinked += 1;
        }
        await linkMutablePilotProjections(tx, pilot.id, person.id);
        const plans = await tx.upgradePlan.findMany({
          where: { pilotId: pilot.id },
          select: { id: true },
        });
        for (const plan of plans) {
          await tx.upgradePlan.update({
            where: { id: plan.id },
            data: {
              personId: person.id,
              positionAssignmentId: positionAssignment.id,
              positionCodeSnapshot: pilotPosition.code,
              positionNameSnapshot: pilotPosition.name,
            },
          });
          summary.plansLinked += 1;
        }
      }

      await tx.organizationTemplateInstallation.upsert({
        where: {
          organizationId_templatePackId: {
            organizationId: organization.id,
            templatePackId: pack.id,
          },
        },
        update: { status: "SUCCEEDED", result: { migrated: true } },
        create: {
          organizationId: organization.id,
          templatePackId: pack.id,
          status: "SUCCEEDED",
          result: { migrated: true },
        },
      });
    });
  }
  console.log(JSON.stringify({ dryRun: false, ...summary }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
