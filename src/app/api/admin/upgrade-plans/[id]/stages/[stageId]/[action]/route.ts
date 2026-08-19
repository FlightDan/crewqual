import { NextRequest } from "next/server";
import { z } from "zod";
import {
  assertExpectedVersion,
  ApiError,
  assertSameOrigin,
  getRequestId,
  jsonData,
  jsonError,
  parseJson,
} from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";
import { serializeUpgradePlan } from "@/server/serializers";
import { relatedPilotUnitWhere } from "@/server/admin-permissions";
import { assertStageCanComplete, assertStageDates } from "@/server/upgrade-plan-rules";
import {
  upgradeStageCompletionSchema,
  upgradeStageRescheduleSchema,
} from "@/lib/admin-operations-validation";
import { emitPilotNotification } from "@/server/notifications";
/* eslint-disable @typescript-eslint/no-explicit-any */

const expectedVersionSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; stageId: string; action: string }> },
) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "operations.write", true);
    const { id, stageId, action } = await context.params;
    if (!["reschedule", "complete"].includes(action))
      throw new ApiError("INVALID_ACTION", "不支持的节点操作", 400);
    const rawInput = await parseJson(request, z.unknown());
    const input =
      action === "reschedule"
        ? upgradeStageRescheduleSchema.and(expectedVersionSchema).parse(rawInput)
        : upgradeStageCompletionSchema.and(expectedVersionSchema).parse(rawInput);
    const db = getPrisma();
    const plan = await db.upgradePlan.findFirst({
      where: { id, ...relatedPilotUnitWhere(admin) },
      include: {
        stages: { orderBy: { order: "asc" } },
        inspectionItems: { include: { stage: true } },
        pilot: true,
      },
    });
    if (!plan) throw new ApiError("NOT_FOUND", "升级计划不存在", 404);
    assertExpectedVersion(plan.version, input.expectedVersion);
    const stageIndex = plan.stages.findIndex((stage) => stage.id === stageId);
    if (stageIndex < 0) throw new ApiError("NOT_FOUND", "升级节点不存在", 404);
    const existing = plan.stages[stageIndex]!;
    if ("plannedStart" in input) {
      assertStageDates(
        {
          startDate: plan.startDate.toISOString().slice(0, 10),
          endDate: plan.endDate.toISOString().slice(0, 10),
        },
        plan.stages.map((stage) => ({
          plannedStart: stage.plannedStart.toISOString().slice(0, 10),
          plannedEnd: stage.plannedEnd.toISOString().slice(0, 10),
        })),
        stageIndex,
        input.plannedStart,
        input.plannedEnd,
      );
      const notes = input.notes ?? existing.notes;
      if (
        input.plannedStart === existing.plannedStart.toISOString().slice(0, 10) &&
        input.plannedEnd === existing.plannedEnd.toISOString().slice(0, 10) &&
        notes === existing.notes
      ) {
        return jsonData(serializeUpgradePlan({ ...plan, stages: plan.stages }), requestId);
      }
    } else {
      assertStageCanComplete(
        plan.lifecycleStatus.toLowerCase() as any,
        plan.stages.map((stage) => ({ status: stage.status.toLowerCase() as any })),
        stageIndex,
        input.completedOn,
        {
          startDate: plan.startDate.toISOString().slice(0, 10),
          endDate: plan.endDate.toISOString().slice(0, 10),
        },
      );
    }
    const updatedPlan = await db.$transaction(async (tx) => {
      const updated = await tx.upgradePlan.updateMany({
        where: { id, version: plan.version },
        data: { version: { increment: 1 } },
      });
      if (updated.count !== 1)
        throw new ApiError("VERSION_CONFLICT", "升级计划已被其他操作更新", 409);
      if ("plannedStart" in input) {
        await tx.upgradeStage.update({
          where: { id: stageId },
          data: {
            plannedStart: new Date(`${input.plannedStart}T00:00:00.000Z`),
            plannedEnd: new Date(`${input.plannedEnd}T00:00:00.000Z`),
            notes: input.notes ?? existing.notes,
          },
        });
      } else {
        await tx.upgradeStage.update({
          where: { id: stageId },
          data: {
            completedOn: new Date(`${input.completedOn}T00:00:00.000Z`),
            resultSummary: input.resultSummary,
            status: "COMPLETED",
          },
        });
        await tx.upgradePlanInspectionItem.updateMany({
          where: { planId: id, stageId },
          data: {
            status: "COMPLETED",
            completedOn: new Date(`${input.completedOn}T00:00:00.000Z`),
            resultSummary: input.resultSummary,
          },
        });
        const nextStage = plan.stages[stageIndex + 1];
        if (nextStage && nextStage.status === "NOT_STARTED") {
          await tx.upgradeStage.update({
            where: { id: nextStage.id },
            data: { status: "SCHEDULED" },
          });
        }
        if (plan.stages.length > 0 && stageIndex === plan.stages.length - 1) {
          await tx.upgradePlan.update({ where: { id }, data: { lifecycleStatus: "COMPLETED" } });
        }
      }
      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          actorId: admin.id,
          action: `upgrade_stage.${action}`,
          entityType: "UpgradeStage",
          entityId: stageId,
          detail: input,
          requestId,
        },
      });
      await emitPilotNotification(tx, {
        eventKey: `upgrade-stage:${stageId}:${action}:${
          "plannedStart" in input ? input.plannedStart : input.completedOn
        }`,
        pilotId: plan.pilotId,
        type: action === "reschedule" ? "stage_date_changed" : "stage_completed",
        templateKey:
          action === "reschedule" ? "upgrade.stage.rescheduled" : "upgrade.stage.completed",
        templateParams: { stageCode: existing.code, stageOrder: existing.order },
      });
      return tx.upgradePlan.findUnique({
        where: { id },
        include: { stages: true, inspectionItems: { include: { stage: true } } },
      });
    });
    if (!updatedPlan) throw new ApiError("NOT_FOUND", "升级计划不存在", 404);
    return jsonData(serializeUpgradePlan(updatedPlan), requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
