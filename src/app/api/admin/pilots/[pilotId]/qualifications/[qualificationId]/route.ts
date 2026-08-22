import { NextRequest } from "next/server";
import {
  adminQualificationRecordCreateSchema,
  adminQualificationRecordUpdateSchema,
} from "@/lib/admin-operations-validation";
import { deriveQualificationDateState } from "@/lib/qualification-date-status";
import {
  parseValidityRule,
  qualificationRuleSnapshot,
  validateQualificationRuleFields,
} from "@/lib/qualification-rules";
import {
  ApiError,
  assertExpectedVersion,
  getRequestId,
  jsonData,
  jsonError,
  parseJson,
} from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { relatedPilotUnitWhere } from "@/server/admin-permissions";
import { getPrisma } from "@/server/prisma";
import type { Prisma } from "@/generated/prisma/client";

const dateOnly = (value: Date | null | undefined) => value?.toISOString().slice(0, 10) ?? "";

type QualificationRecordWithType = Prisma.QualificationRecordGetPayload<{
  include: { qualificationType: true };
}>;

function mapQualificationRecord(record: QualificationRecordWithType) {
  const expiryDate = dateOnly(record.expiryDate);
  return {
    ...deriveQualificationDateState(expiryDate),
    recordId: record.id,
    qualificationId: record.qualificationType.code,
    qualificationName: record.qualificationType.name,
    qualificationTranslations: record.qualificationType.translations,
    credentialNumber: record.credentialNumber,
    issueDate: dateOnly(record.issueDate),
    trainingDate: dateOnly(record.trainingDate),
    expiryDate,
    issuingAuthority: record.issuingAuthority,
    levelOrParameter: record.levelOrParameter,
    lastVerifiedOn: dateOnly(record.lastVerifiedAt),
    version: record.version,
  };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ pilotId: string; qualificationId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "operations.write", true);
    const { pilotId, qualificationId } = await context.params;
    const input = await parseJson(request, adminQualificationRecordCreateSchema);
    const db = getPrisma();
    const type = await db.qualificationType.findFirst({
      where: { code: qualificationId, active: true },
    });
    if (!type) throw new ApiError("NOT_FOUND", "资质类型不存在或已停用", 404);
    const pilot = await db.pilot.findFirst({
      where: { id: pilotId, active: true, ...relatedPilotUnitWhere(admin) },
      select: { id: true, personId: true, person: { select: { organizationId: true } } },
    });
    if (!pilot) throw new ApiError("PILOT_NOT_FOUND", "未找到飞行员", 404);
    const validation = validateQualificationRuleFields(
      {
        issueDate: input.issueDate,
        trainingDate: input.trainingDate || null,
        expiryDate: input.expiryDate || null,
        levelOrParameter: input.levelOrParameter,
      },
      parseValidityRule(type.validityRule),
      type.parameterRestriction,
    );
    if (validation.errors.length) {
      throw new ApiError(
        "VALIDATION_ERROR",
        validation.errors[0]!.message,
        422,
        Object.fromEntries(validation.errors.map((error) => [error.field, [error.message]])),
      );
    }
    const definition =
      pilot.personId && pilot.person?.organizationId
        ? await db.qualificationDefinition.findFirst({
            where: {
              organizationId: pilot.person.organizationId,
              legacyQualificationTypeId: type.id,
              active: true,
            },
            select: { id: true },
          })
        : null;
    const created = (await db.$transaction(async (tx) => {
      const active = await tx.qualificationRecord.findFirst({
        where: { pilotId: pilot.id, qualificationTypeId: type.id, status: "ACTIVE" },
        select: { id: true },
      });
      if (active) {
        throw new ApiError("DUPLICATE_ACTIVE_QUALIFICATION", "该人员已有生效中的同类资质", 409);
      }
      const record = await tx.qualificationRecord.create({
        data: {
          pilotId: pilot.id,
          personId: pilot.personId,
          qualificationTypeId: type.id,
          qualificationDefinitionId: definition?.id,
          credentialNumber: input.credentialNumber,
          issueDate: new Date(`${input.issueDate}T00:00:00.000Z`),
          trainingDate: input.trainingDate ? new Date(`${input.trainingDate}T00:00:00.000Z`) : null,
          expiryDate: validation.expiryDate
            ? new Date(`${validation.expiryDate}T00:00:00.000Z`)
            : null,
          issuingAuthority: input.issuingAuthority,
          levelOrParameter: input.levelOrParameter,
          qualificationRuleSnapshot: qualificationRuleSnapshot(type),
          status: "ACTIVE",
          action: "ADMIN_IMPORT",
          actorId: admin.id,
          reason: "管理员直接录入并确认",
          requestId,
          activatedAt: new Date(),
          lastVerifiedAt: new Date(),
        },
        include: { qualificationType: true },
      });
      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          actorId: admin.id,
          pilotId,
          action: "qualification.admin_created",
          entityType: "QualificationRecord",
          entityId: record.id,
          detail: {
            qualificationId,
            issueDate: input.issueDate,
            trainingDate: input.trainingDate,
            expiryDate: validation.expiryDate,
          },
          requestId,
        },
      });
      return record;
    })) as QualificationRecordWithType;
    return jsonData(mapQualificationRecord(created), requestId, 201);
  } catch (error) {
    return jsonError(error, requestId);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ pilotId: string; qualificationId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "operations.write", true);
    const { pilotId, qualificationId } = await context.params;
    const input = await parseJson(request, adminQualificationRecordUpdateSchema);
    const db = getPrisma();
    const existing = await db.qualificationRecord.findFirst({
      where: {
        pilotId,
        status: "ACTIVE",
        qualificationType: { code: qualificationId },
        ...relatedPilotUnitWhere(admin),
      },
      include: { qualificationType: true },
    });
    if (!existing) throw new ApiError("NOT_FOUND", "生效资质记录不存在", 404);
    const validation = validateQualificationRuleFields(
      {
        issueDate: input.issueDate,
        trainingDate: input.trainingDate || null,
        expiryDate: input.expiryDate || null,
        levelOrParameter: input.levelOrParameter,
      },
      parseValidityRule(existing.qualificationType.validityRule),
      existing.qualificationType.parameterRestriction,
    );
    if (validation.errors.length) {
      throw new ApiError(
        "VALIDATION_ERROR",
        validation.errors[0]!.message,
        422,
        Object.fromEntries(validation.errors.map((error) => [error.field, [error.message]])),
      );
    }
    assertExpectedVersion(existing.version, input.expectedVersion);

    const before = {
      credentialNumber: existing.credentialNumber,
      issueDate: dateOnly(existing.issueDate),
      trainingDate: dateOnly(existing.trainingDate),
      expiryDate: dateOnly(existing.expiryDate),
      issuingAuthority: existing.issuingAuthority,
      levelOrParameter: existing.levelOrParameter,
    };
    const after = {
      credentialNumber: input.credentialNumber,
      issueDate: input.issueDate,
      trainingDate: input.trainingDate,
      expiryDate: validation.expiryDate ?? "",
      issuingAuthority: input.issuingAuthority,
      levelOrParameter: input.levelOrParameter,
    };
    const changedFields = (Object.keys(after) as Array<keyof typeof after>).filter(
      (field) => before[field] !== after[field],
    );

    const updated = await db.$transaction(async (tx) => {
      const claimed = await tx.qualificationRecord.updateMany({
        where: { id: existing.id, version: existing.version, status: "ACTIVE" },
        data: { status: "REPLACED", version: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new Error("VERSION_CONFLICT");
      const replacement = await tx.qualificationRecord.create({
        data: {
          pilotId: existing.pilotId,
          personId: existing.personId,
          qualificationTypeId: existing.qualificationTypeId,
          qualificationDefinitionId: existing.qualificationDefinitionId,
          credentialNumber: after.credentialNumber,
          issueDate: new Date(`${after.issueDate}T00:00:00.000Z`),
          trainingDate: after.trainingDate ? new Date(`${after.trainingDate}T00:00:00.000Z`) : null,
          expiryDate: validation.expiryDate
            ? new Date(`${validation.expiryDate}T00:00:00.000Z`)
            : null,
          issuingAuthority: after.issuingAuthority,
          levelOrParameter: after.levelOrParameter,
          qualificationRuleSnapshot:
            existing.qualificationRuleSnapshot ??
            qualificationRuleSnapshot(existing.qualificationType),
          status: "ACTIVE",
          lineageId: existing.lineageId,
          revisionNumber: existing.revisionNumber + 1,
          supersedesRecordId: existing.id,
          action: "CORRECT_AND_CONFIRM",
          actorId: admin.id,
          reason: "管理员纠正并确认",
          requestId,
          activatedAt: new Date(),
          lastVerifiedAt: new Date(),
        },
        include: { qualificationType: true },
      });
      await tx.qualificationCorrection.create({
        data: {
          qualificationRecordId: replacement.id,
          actorId: admin.id,
          reason: "admin_active_correction",
          before,
          after,
          requestId,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          actorId: admin.id,
          pilotId,
          action: "qualification.admin_updated",
          entityType: "QualificationRecord",
          entityId: replacement.id,
          detail: { qualificationId, changedFields, before, after },
          requestId,
        },
      });
      return replacement;
    });
    return jsonData(mapQualificationRecord(updated), requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
