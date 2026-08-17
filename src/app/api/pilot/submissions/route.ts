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
import { assertCsrf, authenticatePilot } from "@/server/auth";
import { enqueueInTransaction, QUEUES } from "@/server/jobs";
import { getPrisma } from "@/server/prisma";
import {
  parseValidityRule,
  qualificationRuleSnapshot,
  validateQualificationRuleFields,
} from "@/lib/qualification-rules";
import { getRuntimeIntegration } from "@/server/runtime-settings";
import { persistVerificationForEvidence } from "@/server/qualification-verification";

const schema = z.object({
  qualificationId: z.string().min(1).max(128),
  evidenceId: z.string().uuid(),
  credentialNumber: z.string().trim().min(1).max(128),
  issueDate: z.string().date(),
  trainingDate: z.string().date().nullable().default(null),
  expiryDate: z.string().date().nullable(),
  issuingAuthority: z.string().trim().min(1).max(256),
  levelOrParameter: z.string().trim().min(1).max(256),
  expectedVersion: z.number().int().nonnegative().optional(),
});

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const pilot = await authenticatePilot(request);
    await assertCsrf(request, pilot.csrfToken);
    const input = await parseJson(request, schema);
    const db = getPrisma();
    const qualificationType = await db.qualificationType.findFirst({
      where: { code: input.qualificationId, active: true },
    });
    if (!qualificationType) throw new ApiError("NOT_FOUND", "资质项目不存在", 404);
    const validation = validateQualificationRuleFields(
      {
        issueDate: input.issueDate,
        trainingDate: input.trainingDate,
        expiryDate: input.expiryDate,
        levelOrParameter: input.levelOrParameter,
      },
      parseValidityRule(qualificationType.validityRule),
      qualificationType.parameterRestriction,
    );
    if (validation.errors.length) {
      throw new ApiError(
        "VALIDATION_ERROR",
        validation.errors[0]!.message,
        422,
        Object.fromEntries(validation.errors.map((error) => [error.field, [error.message]])),
      );
    }
    const image = await db.evidenceImage.findFirst({ where: { id: input.evidenceId } });
    if (!image || image.pilotId !== pilot.id) {
      throw new ApiError("NOT_FOUND", "凭证不存在", 404);
    }
    if (image.status !== "orphaned") {
      throw new ApiError("EVIDENCE_UNAVAILABLE", "该凭证已提交或不可用", 409);
    }
    const existing = await db.qualificationRecord.findFirst({
      where: { pilotId: pilot.id, qualificationTypeId: qualificationType.id, status: "ACTIVE" },
    });
    if (input.expectedVersion !== undefined && (existing?.version ?? 0) !== input.expectedVersion) {
      throw new ApiError("VERSION_CONFLICT", "数据已被其他操作更新，请刷新后重试", 409);
    }
    const vlm = await getRuntimeIntegration("vlm");
    const submission = await db.$transaction(async (tx) => {
      const duplicate = await tx.qualificationUpdateRequest.findFirst({
        where: {
          pilotId: pilot.id,
          qualificationTypeId: qualificationType.id,
          status: "PENDING",
        },
      });
      if (duplicate) throw new ApiError("DUPLICATE_SUBMISSION", "该资质已有待处理申请", 409);
      const claimed = await tx.evidenceImage.updateMany({
        where: { id: image.id, pilotId: pilot.id, status: "orphaned" },
        data: {
          status: "linked",
          linkedAt: new Date(),
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });
      if (claimed.count !== 1) {
        throw new ApiError("EVIDENCE_UNAVAILABLE", "该凭证已提交或不可用", 409);
      }
      const created = await tx.qualificationUpdateRequest.create({
        data: {
          pilotId: pilot.id,
          qualificationTypeId: qualificationType.id,
          credentialNumber: input.credentialNumber,
          issueDate: new Date(`${input.issueDate}T00:00:00.000Z`),
          trainingDate: input.trainingDate ? new Date(`${input.trainingDate}T00:00:00.000Z`) : null,
          expiryDate: validation.expiryDate
            ? new Date(`${validation.expiryDate}T00:00:00.000Z`)
            : null,
          issuingAuthority: input.issuingAuthority,
          levelOrParameter: input.levelOrParameter,
          qualificationRuleSnapshot: qualificationRuleSnapshot(qualificationType),
          submittedFields: {
            credentialNumber: input.credentialNumber,
            issueDate: input.issueDate,
            trainingDate: input.trainingDate ?? "",
            expiryDate: validation.expiryDate ?? "",
            issuingAuthority: input.issuingAuthority,
            levelOrParameter: input.levelOrParameter,
          },
          expectedVersion: existing?.version ?? 0,
        },
      });
      await tx.qualificationEvidence.create({
        data: { evidenceImageId: image.id, updateRequestId: created.id },
      });
      const insertedTask = await tx.recognitionTask.createMany({
        data: [
          {
            evidenceImageId: image.id,
            taskType: "EXTRACTION",
            status: "QUEUED",
            retryLimit: vlm.retryLimit,
            provider: vlm.model || vlm.adapter,
          },
        ],
        skipDuplicates: true,
      });
      const recognition = await tx.recognitionTask.findUniqueOrThrow({
        where: {
          evidenceImageId_taskType: {
            evidenceImageId: image.id,
            taskType: "EXTRACTION",
          },
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: "pilot",
          actorId: pilot.id,
          pilotId: pilot.id,
          action: "qualification.submitted",
          entityType: "QualificationUpdateRequest",
          entityId: created.id,
          detail: { qualificationId: input.qualificationId },
          requestId,
        },
      });
      if (recognition.status === "COMPLETED" && recognition.result) {
        await persistVerificationForEvidence(tx, image.id, recognition.result);
      } else if (insertedTask.count === 1) {
        await enqueueInTransaction(tx, QUEUES.recognition, {
          recognitionId: recognition.id,
          evidenceImageId: image.id,
        });
      }
      return created;
    });
    return jsonData(
      { id: submission.id, status: "received", submittedAt: submission.submittedAt.toISOString() },
      requestId,
      201,
    );
  } catch (error) {
    return jsonError(error, requestId);
  }
}
