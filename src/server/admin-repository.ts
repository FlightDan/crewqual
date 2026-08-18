import { ApiError, assertExpectedVersion } from "@/server/api";
import { getPrisma } from "@/server/prisma";
import { getPrivateEvidenceUrl } from "@/server/storage";
import {
  parseQualificationRuleSnapshot,
  validateQualificationRuleFields,
} from "@/lib/qualification-rules";
import { deriveQualificationDateState } from "@/lib/qualification-date-status";
import type { AuthenticatedAdmin } from "@/server/auth";
import { pilotUnitWhere, relatedPilotUnitWhere } from "@/server/admin-permissions";
import {
  reviewCredentialFieldsSchema,
  type ReviewCredentialFieldsInput,
} from "@/lib/admin-review-validation";
import { emitPilotNotification } from "@/server/notifications";
/* eslint-disable @typescript-eslint/no-explicit-any */

const dateOnly = (date: Date | null) => date?.toISOString().slice(0, 10) ?? "";

function requestSnapshot(value: unknown) {
  try {
    return parseQualificationRuleSnapshot(value);
  } catch {
    throw new ApiError(
      "QUALIFICATION_RULE_SNAPSHOT_INVALID",
      "申请缺少有效的资质规则快照，必须人工处理后再审批",
      409,
    );
  }
}

function qualificationChangedSinceSubmission() {
  return new ApiError(
    "QUALIFICATION_CHANGED_SINCE_SUBMISSION",
    "正式资质在申请提交后已发生变化，请重新核对后处理",
    409,
  );
}

function isActiveQualificationUniqueConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002" &&
    String((error as { meta?: { target?: unknown } }).meta?.target ?? "").includes(
      "QualificationRecord_one_active_per_pilot_type",
    )
  );
}

function ruleValidationError(errors: Array<{ field: string; message: string }>) {
  return new ApiError(
    "VALIDATION_ERROR",
    errors[0]?.message ?? "资质字段不符合申请提交时的规则",
    422,
    Object.fromEntries(errors.map((error) => [error.field, [error.message]])),
  );
}

export async function listAdminPilots(
  admin: AuthenticatedAdmin,
  query: {
    q?: string;
    health?: string;
    upgrade?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  },
) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const where: any = {
    ...pilotUnitWhere(admin),
    ...(query.q
      ? {
          OR: [
            { displayName: { contains: query.q, mode: "insensitive" } },
            { employeeNumber: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const db = getPrisma();
  const pilots = await db.pilot.findMany({
    where,
    include: {
      qualifications: { where: { status: "ACTIVE" }, include: { qualificationType: true } },
      unit: true,
      upgradePlans: {
        where: { lifecycleStatus: { in: ["ACTIVE", "PAUSED", "NOT_STARTED"] } },
        take: 1,
      },
    },
    orderBy: { displayName: "asc" },
  });
  const filtered = pilots
    .map((pilot: any) => {
      const states = pilot.qualifications.map((record: any) => {
        const status = deriveQualificationDateState(dateOnly(record.expiryDate)).status;
        return status === "expired" ? "expired" : status === "valid" ? "normal" : "expiring";
      });
      const health = !states.length
        ? "unconfigured"
        : states.includes("expired")
          ? "expired"
          : states.includes("expiring")
            ? "expiring"
            : "normal";
      return {
        id: pilot.id,
        employeeNumber: pilot.employeeNumber,
        displayName: pilot.displayName,
        initials: pilot.initials,
        mobile: pilot.mobile,
        role: pilot.role,
        aircraftType: pilot.aircraftType,
        unit: pilot.unit.name,
        unitCode: pilot.unit.code,
        rankCode: pilot.rankLabel,
        active: pilot.active,
        version: pilot.version,
        health,
        expiredCount: states.filter((state: string) => state === "expired").length,
        expiringCount: states.filter((state: string) => state === "expiring").length,
        activeUpgradeTitle: pilot.upgradePlans[0]?.title ?? null,
      };
    })
    .filter(
      (pilot: any) =>
        (!query.health || query.health === "all" || pilot.health === query.health) &&
        (!query.status ||
          query.status === "all" ||
          (query.status === "active" ? pilot.active : !pilot.active)) &&
        (!query.upgrade ||
          query.upgrade === "all" ||
          (query.upgrade === "none"
            ? !pilot.activeUpgradeTitle
            : Boolean(pilot.activeUpgradeTitle))),
    );
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
  };
}

export async function getAdminPilot(admin: AuthenticatedAdmin, id: string) {
  const db = getPrisma();
  const pilot = await db.pilot.findFirst({
    where: { id, ...pilotUnitWhere(admin) },
    include: {
      qualifications: { where: { status: "ACTIVE" }, include: { qualificationType: true } },
      unit: true,
      upgradePlans: { include: { stages: true }, orderBy: { updatedAt: "desc" }, take: 1 },
      updateRequests: {
        include: {
          pilot: true,
          qualificationType: true,
          evidence: { include: { evidenceImage: true } },
          verifications: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: { submittedAt: "desc" },
      },
      auditEvents: { orderBy: { createdAt: "desc" }, take: 100 },
    },
  });
  if (!pilot) return null;
  const qualificationStates = pilot.qualifications.map((record: any) => {
    const status = deriveQualificationDateState(dateOnly(record.expiryDate)).status;
    return status === "expired" ? "expired" : status === "valid" ? "normal" : "expiring";
  });
  const health = !qualificationStates.length
    ? "unconfigured"
    : qualificationStates.includes("expired")
      ? "expired"
      : qualificationStates.includes("expiring")
        ? "expiring"
        : "normal";
  return {
    id: pilot.id,
    employeeNumber: pilot.employeeNumber,
    displayName: pilot.displayName,
    initials: pilot.initials,
    mobile: pilot.mobile,
    role: pilot.role,
    aircraftType: pilot.aircraftType,
    unit: pilot.unit.name,
    unitCode: pilot.unit.code,
    rankCode: pilot.rankLabel,
    active: pilot.active,
    version: pilot.version,
    health,
    expiredCount: qualificationStates.filter((state) => state === "expired").length,
    expiringCount: qualificationStates.filter((state) => state === "expiring").length,
    activeUpgradeTitle:
      pilot.upgradePlans.find((plan: any) =>
        ["ACTIVE", "PAUSED", "NOT_STARTED"].includes(plan.lifecycleStatus),
      )?.title ?? null,
    rankLabel: pilot.rankLabel,
    qualifications: pilot.qualifications.map((record: any) => {
      const expiresOn = dateOnly(record.expiryDate);
      const state = deriveQualificationDateState(expiresOn);
      return {
        id: record.qualificationType.code,
        name: record.qualificationType.name,
        parameter: record.levelOrParameter,
        expiresOn,
        credentialNumber: record.credentialNumber,
        issueDate: dateOnly(record.issueDate),
        expiryDate: expiresOn,
        issuingAuthority: record.issuingAuthority,
        levelOrParameter: record.levelOrParameter,
        lastVerifiedOn: dateOnly(record.lastVerifiedAt),
        status: state.status,
        statusLabel: state.statusLabel,
        remainingLabel: state.remainingLabel,
      };
    }),
    qualificationRecords: pilot.qualifications.map((record: any) => ({
      id: record.qualificationType.code,
      name: record.qualificationType.name,
      parameter: record.levelOrParameter,
      expiresOn: dateOnly(record.expiryDate),
      credentialNumber: record.credentialNumber,
      issueDate: dateOnly(record.issueDate),
      expiryDate: dateOnly(record.expiryDate),
      issuingAuthority: record.issuingAuthority,
      levelOrParameter: record.levelOrParameter,
      lastVerifiedOn: dateOnly(record.lastVerifiedAt),
      version: record.version,
    })),
    upgradePlan: pilot.upgradePlans[0]
      ? {
          id: pilot.upgradePlans[0].id,
          planNumber: pilot.upgradePlans[0].planNumber,
          pilotId: pilot.upgradePlans[0].pilotId,
          title: pilot.upgradePlans[0].title,
          type: pilot.upgradePlans[0].type.toLowerCase(),
          lifecycleStatus: pilot.upgradePlans[0].lifecycleStatus.toLowerCase(),
          startDate: dateOnly(pilot.upgradePlans[0].startDate),
          endDate: dateOnly(pilot.upgradePlans[0].endDate),
          overallOwner: pilot.upgradePlans[0].overallOwner,
          leadDepartment: pilot.upgradePlans[0].leadDepartment,
          stages: pilot.upgradePlans[0].stages.map((stage: any) => ({
            id: stage.id,
            name: stage.name,
            status: stage.status.toLowerCase(),
            plannedStart: dateOnly(stage.plannedStart),
            plannedEnd: dateOnly(stage.plannedEnd),
            owner: stage.owner,
            notes: stage.notes,
            completedOn: dateOnly(stage.completedOn),
            resultSummary: stage.resultSummary ?? undefined,
            delayDays: stage.delayDays ?? undefined,
          })),
          supplementalRequirements: pilot.upgradePlans[0].supplementalRequirements as string[],
          createdAt: pilot.upgradePlans[0].createdAt.toISOString(),
          updatedAt: pilot.upgradePlans[0].updatedAt.toISOString(),
          audit: [],
          version: pilot.upgradePlans[0].version,
        }
      : null,
    reviews: pilot.updateRequests.map(mapReview),
    electronicFiles: [],
    systemAudit: pilot.auditEvents.map((event: any) => ({
      id: event.id,
      action: event.action,
      actor: event.actorType === "admin" ? "管理员" : event.actorType,
      occurredAt: event.createdAt.toISOString(),
      detail:
        typeof event.detail === "object" && event.detail
          ? Object.entries(event.detail)
              .map(([key, value]) => `${key}: ${String(value)}`)
              .join("；")
          : String(event.detail ?? event.action),
    })),
  };
}

async function reviewWithRelations(admin: AuthenticatedAdmin, id: string) {
  return getPrisma().qualificationUpdateRequest.findFirst({
    where: { id, ...relatedPilotUnitWhere(admin) },
    include: {
      pilot: true,
      qualificationType: true,
      evidence: { include: { evidenceImage: true } },
      qualificationRecord: { include: { qualificationType: true } },
      verifications: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

export function mapReview(request: any) {
  const verification = request.verifications?.[0];
  const aiStatus =
    verification?.status?.toLowerCase() === "matched"
      ? "matched"
      : verification?.status?.toLowerCase() === "mismatch"
        ? "mismatch"
        : verification?.status?.toLowerCase() === "unavailable"
          ? "unavailable"
          : verification
            ? "question"
            : "unavailable";
  const currentFields = {
    credentialNumber: request.credentialNumber,
    issueDate: dateOnly(request.issueDate),
    trainingDate: dateOnly(request.trainingDate),
    expiryDate: dateOnly(request.expiryDate),
    issuingAuthority: request.issuingAuthority,
    levelOrParameter: request.levelOrParameter,
  };
  const submittedFields = normalizeSubmittedFields(request, currentFields);
  const corrections = Object.fromEntries(
    Object.keys(submittedFields)
      .filter(
        (field) =>
          currentFields[field as keyof typeof currentFields] !==
          submittedFields[field as keyof typeof submittedFields],
      )
      .map((field) => [field, currentFields[field as keyof typeof currentFields]]),
  );
  const extraction = (verification?.result?.extraction ?? {}) as {
    fields?: Record<string, string | null>;
    confidence?: number;
  };
  const recognizedFields = (extraction.fields ?? {}) as Record<string, string | null>;
  const verificationChecks = (verification?.result?.checks ?? {}) as Record<
    string,
    { status?: string; reason?: string; confidence?: number; extracted?: string }
  >;
  const fieldLabels: Record<string, string> = {
    credentialNumber: "证照编号",
    issueDate: "签发日期",
    trainingDate: "培训日期",
    expiryDate: "有效期至",
    issuingAuthority: "签发机构",
    levelOrParameter: "等级 / 参数",
  };
  return {
    id: request.id,
    pilotId: request.pilotId,
    pilotName: request.pilot.displayName,
    employeeNumber: request.pilot.employeeNumber,
    role: request.pilot.role,
    qualificationId: request.qualificationType.code,
    qualificationName: request.qualificationType.name,
    validityRule: (() => {
      try {
        return parseQualificationRuleSnapshot(request.qualificationRuleSnapshot).validityRule;
      } catch {
        return undefined;
      }
    })(),
    ruleVersion: (() => {
      try {
        return parseQualificationRuleSnapshot(request.qualificationRuleSnapshot).version;
      } catch {
        return undefined;
      }
    })(),
    submittedAt: request.submittedAt.toISOString(),
    humanStatus: request.status.toLowerCase(),
    aiStatus,
    aiConclusion: verification?.result?.summary ?? "等待核验",
    aiConfidence: extraction.confidence,
    aiReviewedAt: verification?.createdAt?.toISOString(),
    documentName: "证照 JPEG",
    documentKind: "sanitized-sample",
    submittedFields,
    fieldComparisons: Object.keys(submittedFields).map((field) => ({
      field,
      label: fieldLabels[field],
      submittedValue: submittedFields[field as keyof typeof submittedFields] ?? "",
      source: corrections[field] ? ("manual_modified" as const) : ("user_manual" as const),
      ...(corrections[field] ? { correctedValue: corrections[field] } : {}),
      ...(recognizedFields[field]
        ? {
            aiOriginalValue: recognizedFields[field]!,
            confidence: extraction.confidence,
          }
        : {}),
    })),
    aiComparisons: Object.entries(verificationChecks).map(([field, check]) => ({
      label: fieldLabels[field] ?? field,
      result: `${check.extracted ?? "未识别"} · ${check.reason ?? "等待人工复核"}`,
      status:
        check.status === "PASS" ? "matched" : check.status === "FAIL" ? "mismatch" : "question",
      confidence: check.confidence,
    })),
    currentRecord: request.qualificationRecord
      ? {
          qualificationId: request.qualificationRecord.qualificationType.code,
          credentialNumber: request.qualificationRecord.credentialNumber,
          issueDate: dateOnly(request.qualificationRecord.issueDate),
          trainingDate: dateOnly(request.qualificationRecord.trainingDate),
          expiryDate: dateOnly(request.qualificationRecord.expiryDate),
          issuingAuthority: request.qualificationRecord.issuingAuthority,
          levelOrParameter: request.qualificationRecord.levelOrParameter,
          effectiveFrom: request.qualificationRecord.createdAt.toISOString(),
          status: "active",
        }
      : null,
    corrections,
    audit: [],
    version: request.version,
    evidenceImageId: request.evidence?.[0]?.evidenceImageId,
    decision: request.decidedAt
      ? {
          kind: request.status === "APPROVED" ? "approved" : "returned",
          actor: "管理员",
          occurredAt: request.decidedAt.toISOString(),
          ...(request.returnReason ? { reason: request.returnReason } : {}),
        }
      : undefined,
  };
}

function normalizeSubmittedFields(
  request: any,
  fallback: Record<string, string>,
): Record<string, string> {
  const candidate = request.submittedFields;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return fallback;
  return {
    credentialNumber:
      typeof candidate.credentialNumber === "string"
        ? candidate.credentialNumber
        : fallback.credentialNumber,
    issueDate: typeof candidate.issueDate === "string" ? candidate.issueDate : fallback.issueDate,
    trainingDate:
      typeof candidate.trainingDate === "string" ? candidate.trainingDate : fallback.trainingDate,
    expiryDate:
      typeof candidate.expiryDate === "string" ? candidate.expiryDate : fallback.expiryDate,
    issuingAuthority:
      typeof candidate.issuingAuthority === "string"
        ? candidate.issuingAuthority
        : fallback.issuingAuthority,
    levelOrParameter:
      typeof candidate.levelOrParameter === "string"
        ? candidate.levelOrParameter
        : fallback.levelOrParameter,
  };
}

export async function listAdminReviews(
  admin: AuthenticatedAdmin,
  query: {
    q?: string;
    status?: string;
    ai?: string;
    page?: number;
    pageSize?: number;
  },
) {
  const db = getPrisma();
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const where: any = {
    ...relatedPilotUnitWhere(admin),
    ...(query.status && query.status !== "all" ? { status: query.status.toUpperCase() } : {}),
    ...(query.ai && query.ai !== "all"
      ? {
          verifications: {
            some: {
              status: {
                matched: "MATCHED",
                question: "UNCERTAIN",
                mismatch: "MISMATCH",
                unavailable: "UNAVAILABLE",
              }[query.ai],
            },
          },
        }
      : {}),
    ...(query.q
      ? {
          OR: [
            { pilot: { displayName: { contains: query.q, mode: "insensitive" } } },
            { pilot: { employeeNumber: { contains: query.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [total, requests] = await Promise.all([
    db.qualificationUpdateRequest.count({ where }),
    db.qualificationUpdateRequest.findMany({
      where,
      include: {
        pilot: true,
        qualificationType: true,
        verifications: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { submittedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    items: requests.map(mapReview),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getAdminReview(admin: AuthenticatedAdmin, id: string) {
  const review = await reviewWithRelations(admin, id);
  if (!review) return null;
  const mapped: any = mapReview(review);
  const auditEvents = await getPrisma().auditEvent.findMany({
    where: { entityType: "QualificationUpdateRequest", entityId: id },
    orderBy: { createdAt: "asc" },
  });
  mapped.audit = auditEvents.map((event: any) => ({
    id: event.id,
    action: event.action,
    actor: event.actorType === "admin" ? "管理员" : event.actorType,
    occurredAt: event.createdAt.toISOString(),
    detail: formatAuditDetail(event.action, event.detail),
  }));
  const evidence = review.evidence?.[0]?.evidenceImage;
  if (evidence) {
    mapped.documentUrl = await getPrivateEvidenceUrl(evidence.objectKey, 300);
    mapped.documentKind = "sanitized-sample";
  }
  return mapped;
}

export async function approveReview(
  admin: AuthenticatedAdmin,
  id: string,
  input: { expectedVersion?: number; note?: string; requestId: string },
) {
  const db = getPrisma();
  try {
    return await db.$transaction(async (tx) => {
      const request = await tx.qualificationUpdateRequest.findFirst({
        where: { id, ...relatedPilotUnitWhere(admin) },
        include: { pilot: true, qualificationType: true, evidence: true },
      });
      if (!request) throw new ApiError("NOT_FOUND", "审核申请不存在", 404);
      if (request.status !== "PENDING")
        throw new ApiError("VERSION_CONFLICT", "该申请已经处理", 409);
      assertExpectedVersion(request.version, input.expectedVersion);
      const snapshot = requestSnapshot(request.qualificationRuleSnapshot);
      if (snapshot.snapshotSource === "inferred_backfill") {
        throw new ApiError(
          "QUALIFICATION_RULE_SNAPSHOT_REQUIRES_REVIEW",
          "该历史申请的规则快照由迁移推断，不能自动审批",
          409,
        );
      }
      const ruleValidation = validateQualificationRuleFields(
        {
          issueDate: request.issueDate.toISOString().slice(0, 10),
          trainingDate: request.trainingDate?.toISOString().slice(0, 10) ?? null,
          expiryDate: request.expiryDate?.toISOString().slice(0, 10) ?? null,
          levelOrParameter: request.levelOrParameter,
        },
        snapshot.validityRule,
        snapshot.parameterRestriction,
      );
      if (ruleValidation.errors.length) throw ruleValidationError(ruleValidation.errors);

      const current = await tx.qualificationRecord.findFirst({
        where: {
          pilotId: request.pilotId,
          qualificationTypeId: request.qualificationTypeId,
          status: "ACTIVE",
        },
      });
      if (
        (request.expectedVersion === 0 && current) ||
        (request.expectedVersion > 0 && (!current || current.version !== request.expectedVersion))
      ) {
        throw qualificationChangedSinceSubmission();
      }

      const claimed = await tx.qualificationUpdateRequest.updateMany({
        where: { id, version: request.version, status: "PENDING" },
        data: { version: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new ApiError("VERSION_CONFLICT", "该申请已经处理", 409);

      if (current) {
        const replaced = await tx.qualificationRecord.updateMany({
          where: { id: current.id, version: request.expectedVersion, status: "ACTIVE" },
          data: { status: "REPLACED", version: { increment: 1 } },
        });
        if (replaced.count !== 1) throw qualificationChangedSinceSubmission();
      }

      let replacement;
      try {
        replacement = await tx.qualificationRecord.create({
          data: {
            pilotId: request.pilotId,
            personId: request.personId,
            qualificationTypeId: request.qualificationTypeId,
            qualificationDefinitionId: request.qualificationDefinitionId,
            credentialNumber: request.credentialNumber,
            issueDate: request.issueDate,
            trainingDate: request.trainingDate,
            expiryDate: ruleValidation.expiryDate
              ? new Date(`${ruleValidation.expiryDate}T00:00:00.000Z`)
              : null,
            issuingAuthority: request.issuingAuthority,
            levelOrParameter: request.levelOrParameter,
            qualificationRuleSnapshot: snapshot,
            lineageId: current?.lineageId,
            revisionNumber: current ? current.revisionNumber + 1 : 1,
            supersedesRecordId: current?.id,
            action: "CONFIRM",
            actorId: admin.id,
            requestId: input.requestId,
            activatedAt: new Date(),
            lastVerifiedAt: new Date(),
            version: request.expectedVersion + 1,
          },
        });
      } catch (error) {
        if (isActiveQualificationUniqueConflict(error)) throw qualificationChangedSinceSubmission();
        throw error;
      }

      const updated = await tx.qualificationUpdateRequest.updateMany({
        where: { id, version: request.version + 1, status: "PENDING" },
        data: {
          status: "APPROVED",
          decidedAt: new Date(),
          decisionNote: input.note,
          version: { increment: 1 },
          qualificationRecordId: replacement.id,
        },
      });
      if (updated.count !== 1) throw new ApiError("VERSION_CONFLICT", "该申请已经处理", 409);
      for (const evidence of request.evidence) {
        await tx.qualificationEvidence.update({
          where: { id: evidence.id },
          data: { qualificationRecordId: replacement.id },
        });
        await tx.evidenceImage.update({
          where: { id: evidence.evidenceImageId },
          data: { status: "retained", expiresAt: new Date(Date.now() + 7 * 365 * 86400000) },
        });
      }
      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          actorId: admin.id,
          pilotId: request.pilotId,
          action: "qualification.approved",
          entityType: "QualificationUpdateRequest",
          entityId: id,
          detail: { note: input.note },
          requestId: input.requestId,
        },
      });
      await emitPilotNotification(tx, {
        eventKey: `review-approved:${id}:${request.version}`,
        pilotId: request.pilotId,
        type: "review_approved",
        summary: "资质审核通过",
        message: `${request.qualificationType.name}审核已通过`,
      });
      return replacement;
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "QUALIFICATION_CHANGED_SINCE_SUBMISSION") {
      const request = await db.qualificationUpdateRequest.findFirst({
        where: { id },
        select: { pilotId: true },
      });
      if (request) {
        await db.auditEvent
          .create({
            data: {
              actorType: "admin",
              actorId: admin.id,
              pilotId: request.pilotId,
              action: "qualification.approval_conflict",
              entityType: "QualificationUpdateRequest",
              entityId: id,
              detail: { reason: "active_record_changed" },
              requestId: input.requestId,
            },
          })
          .catch(() => undefined);
      }
    }
    throw error;
  }
}

export async function returnReview(
  admin: AuthenticatedAdmin,
  id: string,
  reason: string,
  expectedVersion: number | undefined,
  requestId: string,
) {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 5 || normalizedReason.length > 1000) {
    throw new ApiError("VALIDATION_ERROR", "退回原因长度必须为 5 到 1000 个字符", 422);
  }
  const db = getPrisma();
  return db.$transaction(async (tx) => {
    const request = await tx.qualificationUpdateRequest.findFirst({
      where: { id, ...relatedPilotUnitWhere(admin) },
      include: { pilot: true, qualificationType: true },
    });
    if (!request) throw new ApiError("NOT_FOUND", "审核申请不存在", 404);
    if (request.status !== "PENDING") throw new ApiError("VERSION_CONFLICT", "该申请已经处理", 409);
    assertExpectedVersion(request.version, expectedVersion);
    const updated = await tx.qualificationUpdateRequest.updateMany({
      where: { id, version: request.version, status: "PENDING" },
      data: {
        status: "RETURNED",
        returnReason: normalizedReason,
        decidedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new ApiError("VERSION_CONFLICT", "该申请已经处理", 409);
    await tx.auditEvent.create({
      data: {
        actorType: "admin",
        actorId: admin.id,
        pilotId: request.pilotId,
        action: "qualification.returned",
        entityType: "QualificationUpdateRequest",
        entityId: id,
        detail: { reason: normalizedReason },
        requestId,
      },
    });
    await emitPilotNotification(tx, {
      eventKey: `review-returned:${id}:${request.version}`,
      pilotId: request.pilotId,
      type: "review_returned",
      summary: "资质申请需补充",
      message: normalizedReason,
    });
  });
}

export async function correctReview(
  admin: AuthenticatedAdmin,
  id: string,
  input: ReviewCredentialFieldsInput,
  expectedVersion: number | undefined,
  requestId: string,
) {
  const db = getPrisma();
  const parsed = reviewCredentialFieldsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "人工纠正字段或日期顺序不合法",
      422,
      parsed.error.flatten().fieldErrors,
    );
  }
  const request = await db.qualificationUpdateRequest.findFirst({
    where: { id, ...relatedPilotUnitWhere(admin) },
  });
  if (!request) throw new ApiError("NOT_FOUND", "审核申请不存在", 404);
  if (request.status !== "PENDING") throw new ApiError("VERSION_CONFLICT", "该申请已经处理", 409);
  assertExpectedVersion(request.version, expectedVersion);
  const snapshot = requestSnapshot(request.qualificationRuleSnapshot);
  const ruleValidation = validateQualificationRuleFields(
    {
      issueDate: parsed.data.issueDate,
      trainingDate: parsed.data.trainingDate || null,
      expiryDate: parsed.data.expiryDate || null,
      levelOrParameter: parsed.data.levelOrParameter,
    },
    snapshot.validityRule,
    snapshot.parameterRestriction,
  );
  if (ruleValidation.errors.length) throw ruleValidationError(ruleValidation.errors);
  const current = {
    credentialNumber: request.credentialNumber,
    issueDate: dateOnly(request.issueDate),
    trainingDate: dateOnly(request.trainingDate),
    expiryDate: dateOnly(request.expiryDate),
    issuingAuthority: request.issuingAuthority,
    levelOrParameter: request.levelOrParameter,
  };
  const next = { ...parsed.data, expiryDate: ruleValidation.expiryDate ?? "" };
  const changedFields = (Object.keys(current) as Array<keyof typeof current>).filter(
    (field) => current[field] !== next[field],
  );
  if (changedFields.length === 0) return getAdminReview(admin, id);
  await db.$transaction(async (tx: any) => {
    const updated = await tx.qualificationUpdateRequest.updateMany({
      where: { id, status: "PENDING", version: request.version },
      data: {
        credentialNumber: next.credentialNumber,
        issueDate: new Date(`${next.issueDate}T00:00:00.000Z`),
        trainingDate: next.trainingDate ? new Date(`${next.trainingDate}T00:00:00.000Z`) : null,
        expiryDate: next.expiryDate ? new Date(`${next.expiryDate}T00:00:00.000Z`) : null,
        issuingAuthority: next.issuingAuthority,
        levelOrParameter: next.levelOrParameter,
        submittedFields: next,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new ApiError("VERSION_CONFLICT", "该申请已经处理", 409);
    await tx.qualificationCorrection.create({
      data: {
        updateRequestId: id,
        actorId: admin.id,
        reason: "review_correction",
        before: current,
        after: next,
        requestId,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorType: "admin",
        actorId: admin.id,
        pilotId: request.pilotId,
        personId: request.personId,
        action: "qualification.corrected",
        entityType: "QualificationUpdateRequest",
        entityId: id,
        detail: { before: current, after: next, changedFields, reason: "review_correction" },
        requestId,
      },
    });
  });
  return getAdminReview(admin, id);
}

function formatAuditDetail(action: string, detail: unknown) {
  if (action === "qualification.corrected") return "管理员保存了人工纠正字段";
  if (action === "qualification.approved") return "管理员人工确认通过了审核申请";
  if (action === "qualification.returned") return "管理员退回申请并要求补充修改";
  if (typeof detail === "string") return detail;
  return action;
}
