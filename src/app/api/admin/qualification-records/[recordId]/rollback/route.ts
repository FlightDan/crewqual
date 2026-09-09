import { NextRequest } from "next/server";
import { z } from "zod";
import {
  ApiError,
  assertSameOrigin,
  getRequestId,
  jsonData,
  jsonError,
  parseJson,
} from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { relatedPilotUnitWhere } from "@/server/admin-permissions";
import { getPrisma } from "@/server/prisma";
import { emitPilotNotification } from "@/server/notifications";

const schema = z.object({
  targetRevisionId: z.string().uuid(),
  expectedCurrentRevisionId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(5).max(1000),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ recordId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "reviews.decide", true);
    const input = await parseJson(request, schema);
    const recordId = (await context.params).recordId;
    if (recordId !== input.expectedCurrentRevisionId) {
      throw new ApiError("VERSION_CONFLICT", "当前资质版本已变化，请刷新后重试", 409);
    }
    const db = getPrisma();
    const current = await db.qualificationRecord.findFirst({
      where: { id: recordId, status: "ACTIVE", ...relatedPilotUnitWhere(admin) },
      include: { evidence: true, pilot: true },
    });
    if (!current) throw new ApiError("NOT_FOUND", "当前生效资质不存在", 404);
    if (current.version !== input.expectedVersion) {
      throw new ApiError("VERSION_CONFLICT", "当前资质版本已变化，请刷新后重试", 409);
    }
    const target = await db.qualificationRecord.findUnique({
      where: { id: input.targetRevisionId },
      include: { evidence: true },
    });
    if (!target || target.id === current.id || target.lineageId !== current.lineageId) {
      throw new ApiError("INVALID_ROLLBACK_TARGET", "目标历史版本不属于当前资质修订链", 422);
    }
    if (
      target.pilotId !== current.pilotId ||
      (target.personId ?? null) !== (current.personId ?? null) ||
      (target.qualificationDefinitionId ?? null) !== (current.qualificationDefinitionId ?? null) ||
      target.qualificationTypeId !== current.qualificationTypeId
    ) {
      throw new ApiError("INVALID_ROLLBACK_TARGET", "目标历史版本的人员或资质定义不一致", 422);
    }
    const result = await db.$transaction(async (tx) => {
      const replaced = await tx.qualificationRecord.updateMany({
        where: { id: current.id, status: "ACTIVE", version: input.expectedVersion },
        data: { status: "REPLACED", version: { increment: 1 } },
      });
      if (replaced.count !== 1) throw new ApiError("VERSION_CONFLICT", "资质已被其他操作更新", 409);
      const replacement = await tx.qualificationRecord.create({
        data: {
          pilotId: current.pilotId,
          personId: current.personId,
          qualificationTypeId: current.qualificationTypeId,
          qualificationDefinitionId: current.qualificationDefinitionId,
          credentialNumber: target.credentialNumber,
          issueDate: target.issueDate,
          trainingDate: target.trainingDate,
          expiryDate: target.expiryDate,
          issuingAuthority: target.issuingAuthority,
          levelOrParameter: target.levelOrParameter,
          qualificationRuleSnapshot: target.qualificationRuleSnapshot as never,
          status: "ACTIVE",
          lineageId: current.lineageId,
          revisionNumber: current.revisionNumber + 1,
          version: current.version + 1,
          supersedesRecordId: current.id,
          restoresRecordId: target.id,
          action: "ROLLBACK",
          actorId: admin.id,
          reason: input.reason,
          requestId,
          activatedAt: new Date(),
          lastVerifiedAt: new Date(),
        },
      });
      for (const evidence of target.evidence) {
        await tx.qualificationEvidence.create({
          data: {
            evidenceImageId: evidence.evidenceImageId,
            qualificationRecordId: replacement.id,
          },
        });
      }
      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          actorId: admin.id,
          pilotId: current.pilotId,
          personId: current.personId,
          action: "qualification.rollback",
          entityType: "QualificationRecord",
          entityId: replacement.id,
          detail: {
            targetRevisionId: target.id,
            replacedRevisionId: current.id,
            reason: input.reason,
          },
          requestId,
        },
      });
      await emitPilotNotification(tx, {
        eventKey: `qualification-rollback:${replacement.id}`,
        pilotId: current.pilotId,
        type: "review_approved",
        templateKey: "qualification.rollback",
        templateParams: {},
      });
      return replacement;
    });
    return jsonData(result, requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
