import { ApiError } from "@/server/api";
import { getAdminPilot } from "@/server/admin-repository";
import { isSuperAdmin, requireAssignedUnit } from "@/server/admin-permissions";
import type { AuthenticatedAdmin } from "@/server/auth";
import { getPrisma } from "@/server/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  createPilotCsvTemplate,
  parsePilotCsv,
  pilotCsvHeaders,
} from "@/lib/pilot-management-validation";
import type {
  PilotImportPreview,
  PilotManagementInput,
  PilotManagementMeta,
  PilotImportMode,
} from "@/types/services";
import {
  parseValidityRule,
  qualificationRuleSnapshot,
  validateQualificationRuleFields,
} from "@/lib/qualification-rules";
/* eslint-disable @typescript-eslint/no-explicit-any */

function pilotInitials(displayName: string) {
  return Array.from(displayName.replace(/\s+/g, "")).slice(0, 2).join("").toLocaleUpperCase();
}

function csvDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Additive dual-write projection used while Pilot remains the compatibility table. */
async function ensurePersonProjection(tx: any, pilot: any, unit: any) {
  if (!unit.organizationId) return null;
  const person = await tx.person.upsert({
    where: { id: pilot.id },
    update: {
      organizationId: unit.organizationId,
      unitId: unit.id,
      employeeNumber: pilot.employeeNumber,
      mobile: pilot.mobile,
      displayName: pilot.displayName,
      initials: pilot.initials,
      active: pilot.active,
      version: pilot.version,
    },
    create: {
      id: pilot.id,
      organizationId: unit.organizationId,
      unitId: unit.id,
      employeeNumber: pilot.employeeNumber,
      mobile: pilot.mobile,
      displayName: pilot.displayName,
      initials: pilot.initials,
      active: pilot.active,
      version: pilot.version,
    },
  });
  await tx.pilot.update({ where: { id: pilot.id }, data: { personId: person.id } });
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
  const position = await tx.position.findUnique({
    where: { organizationId_code: { organizationId: unit.organizationId, code: "PILOT" } },
  });
  if (!position) return person;
  let assignment = await tx.personPositionAssignment.findFirst({
    where: { personId: person.id, positionId: position.id, status: "ACTIVE" },
  });
  if (!assignment) {
    assignment = await tx.personPositionAssignment.create({
      data: {
        personId: person.id,
        positionId: position.id,
        positionCodeSnapshot: position.code,
        positionNameSnapshot: position.name,
        isPrimary: true,
        effectiveFrom: pilot.createdAt,
      },
    });
  }
  await tx.personPositionAssignment.updateMany({
    where: { personId: person.id, status: "ACTIVE", id: { not: assignment.id }, isPrimary: true },
    data: { isPrimary: false },
  });
  const requirements = await tx.qualificationRequirement.findMany({
    where: { positionId: position.id, active: true },
    select: { id: true, qualificationDefinitionId: true },
  });
  for (const requirement of requirements) {
    await tx.qualificationAssignment.upsert({
      where: {
        positionAssignmentId_requirementId: {
          positionAssignmentId: assignment.id,
          requirementId: requirement.id,
        },
      },
      update: { active: true, endedAt: null },
      create: {
        personId: person.id,
        qualificationDefinitionId: requirement.qualificationDefinitionId,
        requirementId: requirement.id,
        positionAssignmentId: assignment.id,
        source: "POSITION_REQUIREMENT",
      },
    });
  }
  const definitions = await tx.qualificationDefinition.findMany({
    where: { organizationId: unit.organizationId },
    select: { id: true, legacyQualificationTypeId: true, code: true },
  });
  return { ...person, assignment, definitions };
}

export async function getPilotManagementMeta(
  admin: AuthenticatedAdmin,
): Promise<PilotManagementMeta> {
  const unitId = requireAssignedUnit(admin);
  const db = getPrisma();
  const unitsWithOrganization = await db.organizationUnit.findMany({
    where: { active: true, ...(unitId ? { id: unitId } : {}) },
    select: { id: true, code: true, name: true, organizationId: true },
    orderBy: { name: "asc" },
  });
  const organizationIds = [
    ...new Set(
      unitsWithOrganization
        .map((unit) => unit.organizationId)
        .filter((organizationId): organizationId is string => Boolean(organizationId)),
    ),
  ];
  const [definitions, legacyTypes] = await Promise.all([
    organizationIds.length
      ? db.qualificationDefinition.findMany({
          where: { organizationId: { in: organizationIds }, active: true },
          select: {
            id: true,
            code: true,
            name: true,
            translations: true,
            validityRule: true,
            version: true,
            parameterRestriction: true,
            legacyQualificationTypeId: true,
          },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        })
      : [],
    db.qualificationType.findMany({
      where: { active: true },
      select: {
        id: true,
        code: true,
        name: true,
        translations: true,
        validityRule: true,
        version: true,
        parameterRestriction: true,
      },
      orderBy: [{ core: "desc" }, { name: "asc" }],
    }),
  ]);
  // Definitions are the source of truth for a newly installed organization.
  // Keep a legacy-only fallback for databases that predate the member model;
  // do not mix definitions from another organization into a scoped admin's
  // metadata.
  const mappedQualifications = definitions.length
    ? [...new Map(definitions.map((definition) => [definition.code, definition])).values()].map(
        (definition) => ({
          id: definition.legacyQualificationTypeId ?? definition.id,
          definitionId: definition.id,
          ...(definition.legacyQualificationTypeId
            ? { legacyQualificationTypeId: definition.legacyQualificationTypeId }
            : {}),
          code: definition.code,
          name: definition.name,
          translations:
            definition.translations && typeof definition.translations === "object"
              ? (definition.translations as Record<string, string>)
              : {},
          validityRule: parseValidityRule(definition.validityRule),
          ruleVersion: definition.version,
          parameterRestriction:
            definition.parameterRestriction as PilotManagementMeta["qualifications"][number]["parameterRestriction"],
        }),
      )
    : legacyTypes.map((qualification) => ({
        id: qualification.id,
        code: qualification.code,
        name: qualification.name,
        translations:
          qualification.translations && typeof qualification.translations === "object"
            ? (qualification.translations as Record<string, string>)
            : {},
        validityRule: parseValidityRule(qualification.validityRule),
        ruleVersion: qualification.version,
        parameterRestriction:
          qualification.parameterRestriction as PilotManagementMeta["qualifications"][number]["parameterRestriction"],
      }));
  return {
    units: unitsWithOrganization.map(({ id, code, name }) => ({ id, code, name })),
    qualifications: mappedQualifications,
    csvHeaders: pilotCsvHeaders(mappedQualifications),
  };
}

export async function getPilotCsvTemplate(admin: AuthenticatedAdmin) {
  const meta = await getPilotManagementMeta(admin);
  return {
    filename: "CrewQual-飞行员批量导入模板.csv",
    content: createPilotCsvTemplate(meta.qualifications),
  };
}

function csvExportCell(value: unknown) {
  const raw = value == null ? "" : String(value);
  // Spreadsheet applications interpret leading formula characters even in a
  // quoted CSV cell. Prefix exported user-controlled values with an apostrophe
  // so employee names, authorities, and notes cannot execute formulas.
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function getPilotCsvExport(admin: AuthenticatedAdmin, requestedUnitId?: string) {
  const assignedUnitId = requireAssignedUnit(admin);
  const unitId = assignedUnitId ?? requestedUnitId;
  if (!unitId) {
    throw new ApiError("UNIT_REQUIRED", "超级管理员导出前必须选择中队", 422);
  }
  const db = getPrisma();
  const unit = await db.organizationUnit.findFirst({
    where: { id: unitId, active: true },
    select: { id: true, code: true, name: true, organizationId: true },
  });
  if (!unit) throw new ApiError("UNIT_NOT_ALLOWED", "中队不存在或已停用", 422);
  const [definitions, legacyTypes, pilots] = await Promise.all([
    unit.organizationId
      ? db.qualificationDefinition.findMany({
          where: { organizationId: unit.organizationId, active: true },
          select: { code: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        })
      : [],
    db.qualificationType.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true },
      orderBy: [{ core: "desc" }, { name: "asc" }],
    }),
    db.pilot.findMany({
      where: { unitId },
      include: {
        unit: true,
        qualifications: {
          where: { status: "ACTIVE" },
          include: {
            qualificationType: { select: { id: true, code: true, name: true, translations: true } },
            qualificationDefinition: { select: { code: true } },
          },
          orderBy: { updatedAt: "desc" },
        },
      },
      orderBy: { employeeNumber: "asc" },
    }),
  ]);
  const qualifications = definitions.length ? definitions : legacyTypes;
  const headers = pilotCsvHeaders(qualifications);
  const rows = pilots.map((pilot) => {
    const records = new Map(
      pilot.qualifications.map((record) => [
        record.qualificationDefinition?.code ?? record.qualificationType.code,
        record,
      ]),
    );
    const values = [
      pilot.employeeNumber,
      pilot.displayName,
      pilot.mobile,
      pilot.aircraftType,
      pilot.roleCode,
      pilot.unit.code,
      pilot.rankLabel,
    ];
    qualifications.forEach((qualification) => {
      const record = records.get(qualification.code);
      values.push(
        record?.issueDate.toISOString().slice(0, 10) ?? "",
        record?.trainingDate?.toISOString().slice(0, 10) ?? "",
        record?.expiryDate?.toISOString().slice(0, 10) ?? "",
        record?.levelOrParameter ?? "",
      );
    });
    return values.map(csvExportCell).join(",");
  });
  return {
    filename: `CrewQual-${unit.code}-中队数据.csv`,
    content: `\uFEFF${headers.map(csvExportCell).join(",")}\r\n${rows.join("\r\n")}${rows.length ? "\r\n" : ""}`,
  };
}

async function allowedUnit(admin: AuthenticatedAdmin, unitCode: string) {
  const unitId = requireAssignedUnit(admin);
  const unit = await getPrisma().organizationUnit.findFirst({
    where: { code: unitCode, active: true, ...(unitId ? { id: unitId } : {}) },
  });
  if (!unit) {
    throw new ApiError(
      "UNIT_NOT_ALLOWED",
      isSuperAdmin(admin) ? "单位代码不存在或已停用" : "只能管理本人所属单位的飞行员",
      422,
    );
  }
  return unit;
}

export async function createAdminPilot(
  admin: AuthenticatedAdmin,
  input: PilotManagementInput,
  requestId: string,
) {
  const [unit, duplicate] = await Promise.all([
    allowedUnit(admin, input.unitCode),
    getPrisma().pilot.findUnique({ where: { employeeNumber: input.employeeNumber } }),
  ]);
  if (duplicate) throw new ApiError("DUPLICATE_EMPLOYEE_NUMBER", "员工号已存在", 409);
  const pilot = await getPrisma().$transaction(async (tx) => {
    const created = await tx.pilot.create({
      data: {
        employeeNumber: input.employeeNumber,
        displayName: input.displayName,
        initials: pilotInitials(input.displayName),
        mobile: input.mobile,
        aircraftType: input.aircraftType,
        roleCode: input.roleCode,
        rankLabel: input.rankCode,
        unitId: unit.id,
      },
    });
    const projection = await ensurePersonProjection(tx, created, unit);
    await tx.auditEvent.create({
      data: {
        actorType: "admin",
        actorId: admin.id,
        pilotId: created.id,
        personId: projection?.id,
        action: "pilot.created",
        entityType: "Pilot",
        entityId: created.id,
        detail: {
          employeeNumber: created.employeeNumber,
          displayName: created.displayName,
          unitCode: input.unitCode,
        },
        requestId,
      },
    });
    return created;
  });
  const detail = await getAdminPilot(admin, pilot.id);
  if (!detail) throw new ApiError("PILOT_NOT_FOUND", "新增飞行员后无法读取档案", 500);
  return detail;
}

export async function updateAdminPilot(
  admin: AuthenticatedAdmin,
  id: string,
  input: PilotManagementInput & { active: boolean; expectedVersion: number },
  requestId: string,
) {
  const current = await getPrisma().pilot.findFirst({
    where: { id, ...(isSuperAdmin(admin) ? {} : { unitId: requireAssignedUnit(admin)! }) },
  });
  if (!current) throw new ApiError("PILOT_NOT_FOUND", "未找到飞行员", 404);
  const [unit, duplicate] = await Promise.all([
    allowedUnit(admin, input.unitCode),
    getPrisma().pilot.findFirst({
      where: { employeeNumber: input.employeeNumber, NOT: { id } },
    }),
  ]);
  if (duplicate) throw new ApiError("DUPLICATE_EMPLOYEE_NUMBER", "员工号已存在", 409);
  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.pilot.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        employeeNumber: input.employeeNumber,
        displayName: input.displayName,
        initials: pilotInitials(input.displayName),
        mobile: input.mobile,
        aircraftType: input.aircraftType,
        roleCode: input.roleCode,
        rankLabel: input.rankCode,
        unitId: unit.id,
        active: input.active,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new ApiError("VERSION_CONFLICT", "人员资料已更新", 409);
    if (!input.active) {
      await tx.pilotSession.deleteMany({ where: { pilotId: id } });
      await tx.pilotAccessToken.deleteMany({ where: { pilotId: id } });
    }
    const projectedPilot = await tx.pilot.findUniqueOrThrow({ where: { id } });
    const projection = await ensurePersonProjection(tx, projectedPilot, unit);
    await tx.auditEvent.create({
      data: {
        actorType: "admin",
        actorId: admin.id,
        pilotId: id,
        personId: projection?.id,
        action:
          current.active !== input.active
            ? input.active
              ? "pilot.activated"
              : "pilot.deactivated"
            : "pilot.updated",
        entityType: "Pilot",
        entityId: id,
        detail: {
          employeeNumber: input.employeeNumber,
          displayName: input.displayName,
          unitCode: input.unitCode,
          active: input.active,
        },
        requestId,
      },
    });
  });
  const detail = await getAdminPilot(admin, id);
  if (!detail) throw new ApiError("PILOT_NOT_FOUND", "未找到飞行员", 404);
  return detail;
}

async function validatePilotCsv(
  admin: AuthenticatedAdmin,
  csvText: string,
  mode: PilotImportMode = "create_only",
) {
  const meta = await getPilotManagementMeta(admin);
  const parsed = parsePilotCsv(csvText, meta.qualifications);
  if (!parsed.rows.length && !parsed.fileErrors.length) {
    parsed.fileErrors.push("CSV 没有可导入的数据行");
  }
  const employeeNumbers = parsed.rows.map((row) => row.input.employeeNumber).filter(Boolean);
  const [existingPilots, units] = await Promise.all([
    employeeNumbers.length
      ? getPrisma().pilot.findMany({
          where: { employeeNumber: { in: employeeNumbers } },
          select: {
            id: true,
            employeeNumber: true,
            version: true,
            unitId: true,
            qualifications: {
              where: { status: "ACTIVE" },
              select: { id: true, qualificationTypeId: true },
            },
          },
        })
      : [],
    getPrisma().organizationUnit.findMany({
      where: {
        active: true,
        ...(isSuperAdmin(admin) ? {} : { id: requireAssignedUnit(admin)! }),
      },
      select: { id: true, code: true, name: true, organizationId: true },
    }),
  ]);
  const existing = new Map(
    existingPilots.map((pilot) => [pilot.employeeNumber.toLowerCase(), pilot]),
  );
  const allowedUnits = new Map(units.map((unit) => [unit.code, unit]));
  parsed.rows.forEach((row) => {
    if (mode === "create_only" && existing.has(row.input.employeeNumber.toLowerCase())) {
      row.errors.push("员工号已存在");
    }
    if (!allowedUnits.has(row.input.unitCode)) {
      row.errors.push(isSuperAdmin(admin) ? "单位代码不存在或已停用" : "单位代码不属于当前管理员");
    }
    row.errors = [...new Set(row.errors)];
  });
  return { ...parsed, allowedUnits, existingPilots: existing, mode };
}

export async function previewPilotCsv(
  admin: AuthenticatedAdmin,
  csvText: string,
  mode: PilotImportMode = "create_only",
): Promise<PilotImportPreview> {
  const result = await validatePilotCsv(admin, csvText, mode);
  const rows = result.rows.map((row) => ({
    rowNumber: row.rowNumber,
    employeeNumber: row.input.employeeNumber,
    displayName: row.input.displayName,
    qualificationCount: row.qualifications.length,
    errors: row.errors,
  }));
  return {
    total: rows.length,
    validCount: rows.filter((row) => row.errors.length === 0).length,
    errorCount: rows.filter((row) => row.errors.length > 0).length,
    createCount: rows.filter(
      (row) =>
        row.errors.length === 0 && !result.existingPilots.has(row.employeeNumber.toLowerCase()),
    ).length,
    updateCount: rows.filter(
      (row) =>
        row.errors.length === 0 && result.existingPilots.has(row.employeeNumber.toLowerCase()),
    ).length,
    fileErrors: result.fileErrors,
    rows,
  };
}

export async function importPilotCsv(
  admin: AuthenticatedAdmin,
  csvText: string,
  requestId: string,
  mode: PilotImportMode = "create_only",
  confirmMerge = false,
) {
  if (mode === "merge" && !confirmMerge) {
    throw new ApiError("MERGE_CONFIRMATION_REQUIRED", "合并导入需要管理员二次确认", 422);
  }
  const result = await validatePilotCsv(admin, csvText, mode);
  const invalidRows = result.rows.filter((row) => row.errors.length > 0);
  const validRows = result.rows.filter((row) => row.errors.length === 0);
  if (result.fileErrors.length || !validRows.length) {
    throw new ApiError(
      "IMPORT_VALIDATION_FAILED",
      `CSV 校验未通过：${result.fileErrors[0] ?? invalidRows[0]?.errors[0] ?? "没有可导入数据"}`,
      422,
    );
  }
  const now = new Date();
  const qualificationIds = [
    ...new Set(validRows.flatMap((row) => row.qualifications.map((item) => item.qualificationId))),
  ];
  const qualificationCodes = [
    ...new Set(
      validRows.flatMap((row) => row.qualifications.map((item) => item.qualificationCode)),
    ),
  ];
  const organizationIds = [
    ...new Set(
      [...result.allowedUnits.values()]
        .map((unit) => unit.organizationId)
        .filter((organizationId): organizationId is string => Boolean(organizationId)),
    ),
  ];
  const db = getPrisma();
  const qualificationDefinitions = organizationIds.length
    ? await db.qualificationDefinition.findMany({
        where: {
          organizationId: { in: organizationIds },
          active: true,
          code: { in: qualificationCodes },
        },
      })
    : [];
  const linkedTypeIds = qualificationDefinitions
    .map((definition) => definition.legacyQualificationTypeId)
    .filter((id): id is string => Boolean(id));
  const qualificationTypes = await db.qualificationType.findMany({
    where: {
      OR: [
        ...(qualificationIds.length ? [{ id: { in: qualificationIds } }] : []),
        ...(linkedTypeIds.length ? [{ id: { in: linkedTypeIds } }] : []),
        ...(qualificationCodes.length ? [{ code: { in: qualificationCodes } }] : []),
      ],
    },
  });
  const qualificationTypeMap = new Map(qualificationTypes.map((type) => [type.id, type]));
  const qualificationTypeByCode = new Map(qualificationTypes.map((type) => [type.code, type]));
  const qualificationDefinitionByOrganizationAndCode = new Map(
    qualificationDefinitions.map((definition) => [
      `${definition.organizationId}:${definition.code}`,
      definition,
    ]),
  );
  for (const row of validRows) {
    const unit = result.allowedUnits.get(row.input.unitCode);
    for (const qualification of row.qualifications) {
      const definition = unit?.organizationId
        ? qualificationDefinitionByOrganizationAndCode.get(
            `${unit.organizationId}:${qualification.qualificationCode}`,
          )
        : undefined;
      const type =
        qualificationTypeMap.get(
          qualification.legacyQualificationTypeId ?? qualification.qualificationId,
        ) ?? qualificationTypeByCode.get(qualification.qualificationCode);
      const ruleSource = type ?? definition;
      if (!ruleSource) throw new ApiError("QUALIFICATION_NOT_FOUND", "资质项目不存在或已停用", 422);
      const validation = validateQualificationRuleFields(
        {
          issueDate: qualification.issueDate,
          trainingDate: qualification.trainingDate || null,
          expiryDate: qualification.expiryDate || null,
          levelOrParameter: qualification.levelOrParameter,
        },
        parseValidityRule(ruleSource.validityRule),
        ruleSource.parameterRestriction,
      );
      if (validation.errors.length) {
        throw new ApiError("IMPORT_VALIDATION_FAILED", validation.errors[0]!.message, 422);
      }
    }
  }
  const imported = await db.$transaction(async (tx) => {
    const pilotIds: string[] = [];
    let qualificationCount = 0;
    let createdCount = 0;
    let updatedCount = 0;
    for (const row of validRows) {
      const unit = result.allowedUnits.get(row.input.unitCode)!;
      const existing = result.existingPilots.get(row.input.employeeNumber.toLowerCase());
      let pilot;
      if (existing) {
        const changed = await tx.pilot.updateMany({
          where: { id: existing.id, version: existing.version },
          data: {
            displayName: row.input.displayName,
            initials: pilotInitials(row.input.displayName),
            mobile: row.input.mobile,
            aircraftType: row.input.aircraftType,
            roleCode: row.input.roleCode,
            rankLabel: row.input.rankCode,
            unitId: unit.id,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1)
          throw new ApiError("VERSION_CONFLICT", "人员资料已更新，请重新导入", 409);
        pilot = await tx.pilot.findUniqueOrThrow({ where: { id: existing.id } });
      } else {
        pilot = await tx.pilot.create({
          data: {
            employeeNumber: row.input.employeeNumber,
            displayName: row.input.displayName,
            initials: pilotInitials(row.input.displayName),
            mobile: row.input.mobile,
            aircraftType: row.input.aircraftType,
            roleCode: row.input.roleCode,
            rankLabel: row.input.rankCode,
            unitId: unit.id,
          },
        });
        createdCount += 1;
      }
      if (existing) updatedCount += 1;
      const projection = await ensurePersonProjection(tx, pilot, unit);
      for (const qualification of row.qualifications) {
        const definition = unit.organizationId
          ? qualificationDefinitionByOrganizationAndCode.get(
              `${unit.organizationId}:${qualification.qualificationCode}`,
            )
          : undefined;
        const definitionId =
          definition?.id ??
          (projection?.definitions?.find(
            (candidate: any) => candidate.code === qualification.qualificationCode,
          )?.id as string | undefined);
        let qualificationType =
          qualificationTypeMap.get(
            qualification.legacyQualificationTypeId ?? qualification.qualificationId,
          ) ?? qualificationTypeByCode.get(qualification.qualificationCode);
        if (!qualificationType && definition) {
          // Custom definitions created after installation may not have a
          // compatibility row yet. Create one transactionally so the legacy
          // record schema can still store an imported record, then link the
          // definition for subsequent requests.
          qualificationType = await tx.qualificationType.upsert({
            where: { code: definition.code },
            update: {},
            create: {
              code: definition.code,
              name: definition.name,
              translations: definition.translations as Prisma.InputJsonValue,
              core: false,
              active: definition.active,
              parameterRestriction: definition.parameterRestriction as Prisma.InputJsonValue,
              validityRule: definition.validityRule as Prisma.InputJsonValue,
              reminders: definition.reminders as Prisma.InputJsonValue,
              ocrChecks: definition.ocrChecks as Prisma.InputJsonValue,
              version: definition.version,
            },
          });
          if (!definition.legacyQualificationTypeId) {
            await tx.qualificationDefinition.update({
              where: { id: definition.id },
              data: { legacyQualificationTypeId: qualificationType.id },
            });
          }
          qualificationTypeMap.set(qualificationType.id, qualificationType);
          qualificationTypeByCode.set(qualificationType.code, qualificationType);
        }
        if (!qualificationType) {
          throw new ApiError("QUALIFICATION_NOT_FOUND", "资质项目不存在或已停用", 422);
        }
        if (definitionId) {
          const definitionConfig = await tx.qualificationDefinition.findUnique({
            where: { id: definitionId },
            select: { requiresEvidence: true, requiresHumanReview: true, allowAutoApproval: true },
          });
          if (
            definitionConfig &&
            (definitionConfig.requiresEvidence || definitionConfig.requiresHumanReview) &&
            !definitionConfig.allowAutoApproval
          ) {
            throw new ApiError(
              "IMPORT_REQUIRES_REVIEW",
              "该资质要求凭证或人工审核，CSV 不能直接激活，请走审核流程",
              422,
            );
          }
        }
        const currentRecord = await tx.qualificationRecord.findFirst({
          where: {
            pilotId: pilot.id,
            qualificationTypeId: qualificationType.id,
            status: "ACTIVE",
          },
        });
        if (currentRecord) {
          const replaced = await tx.qualificationRecord.updateMany({
            where: { id: currentRecord.id, version: currentRecord.version, status: "ACTIVE" },
            data: { status: "REPLACED", version: { increment: 1 } },
          });
          if (replaced.count !== 1)
            throw new ApiError("VERSION_CONFLICT", "正式资质已更新，请重新核对后导入", 409);
        }
        await tx.qualificationRecord.create({
          data: {
            pilotId: pilot.id,
            personId: projection?.id,
            qualificationDefinitionId: definitionId,
            qualificationTypeId: qualificationType.id,
            credentialNumber: "",
            issueDate: csvDate(qualification.issueDate),
            trainingDate: qualification.trainingDate ? csvDate(qualification.trainingDate) : null,
            expiryDate: qualification.expiryDate ? csvDate(qualification.expiryDate) : null,
            issuingAuthority: "CSV 批量导入",
            levelOrParameter: qualification.levelOrParameter,
            qualificationRuleSnapshot: qualificationRuleSnapshot(qualificationType),
            lineageId: currentRecord?.lineageId,
            revisionNumber: currentRecord ? currentRecord.revisionNumber + 1 : 1,
            supersedesRecordId: currentRecord?.id,
            version: (currentRecord?.version ?? 0) + 1,
            action: "ADMIN_IMPORT",
            actorId: admin.id,
            reason: "CSV 导入并确认",
            requestId,
            activatedAt: now,
            lastVerifiedAt: now,
          },
        });
      }
      pilotIds.push(pilot.id);
      qualificationCount += row.qualifications.length;
      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          actorId: admin.id,
          pilotId: pilot.id,
          personId: projection?.id,
          action: existing ? "pilot.csv_merged" : "pilot.csv_imported",
          entityType: "Pilot",
          entityId: pilot.id,
          detail: {
            employeeNumber: pilot.employeeNumber,
            unitCode: row.input.unitCode,
            qualificationCodes: row.qualifications.map((item) => item.qualificationCode),
          },
          requestId,
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        actorType: "admin",
        actorId: admin.id,
        action: "pilot.csv_import.completed",
        entityType: "PilotImport",
        entityId: requestId,
        detail: {
          pilotCount: pilotIds.length,
          createdCount,
          updatedCount,
          qualificationCount,
          mode,
        },
        requestId,
      },
    });
    return { pilotIds, createdCount, updatedCount, qualificationCount };
  });
  return {
    createdCount: imported.createdCount,
    updatedCount: imported.updatedCount,
    skippedCount: invalidRows.length,
    qualificationCount: imported.qualificationCount,
    pilotIds: imported.pilotIds,
  };
}
