import { NextRequest } from "next/server";
import {
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
import { upgradePlanDraftSchema } from "@/lib/admin-operations-validation";
import { z } from "zod";

const patchSchema = upgradePlanDraftSchema.and(
  z.object({ expectedVersion: z.number().int().positive() }),
);

const includePlan = {
  stages: { orderBy: { order: "asc" as const } },
  inspectionItems: { include: { stage: true } },
};

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "operations.read");
    const plan = await getPrisma().upgradePlan.findFirst({
      where: { id: (await context.params).id, ...relatedPilotUnitWhere(admin) },
      include: includePlan,
    });
    if (!plan) throw new ApiError("NOT_FOUND", "升级计划不存在", 404);
    return jsonData(serializeUpgradePlan(plan), requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "operations.write", true);
    const id = (await context.params).id;
    const input = await parseJson(request, patchSchema);
    const db = getPrisma();
    const existing = await db.upgradePlan.findFirst({
      where: { id, ...relatedPilotUnitWhere(admin) },
      include: includePlan,
    });
    if (!existing) throw new ApiError("NOT_FOUND", "升级计划不存在", 404);
    if (["COMPLETED", "CANCELLED"].includes(existing.lifecycleStatus)) {
      throw new ApiError("PLAN_READ_ONLY", "已完成或已取消的计划不可修改", 409);
    }
    if (input.pilotId !== existing.pilotId) {
      throw new ApiError(
        "PLAN_REASSIGN_REQUIRED",
        "人员或职位关联必须使用专用 reassign 操作，并填写原因",
        409,
      );
    }

    const currentSelections = existing.inspectionItems
      .map((item) => `${item.inspectionItemId}:${item.stage.order}`)
      .sort();
    const nextSelections = input.inspectionItemSelections
      .map((item) => `${item.inspectionItemId}:${item.stageOrder}`)
      .sort();
    if (existing.lifecycleStatus === "ACTIVE") {
      const structuralChange =
        input.type.toUpperCase() !== existing.type ||
        input.startDate !== existing.startDate.toISOString().slice(0, 10) ||
        input.endDate !== existing.endDate.toISOString().slice(0, 10) ||
        JSON.stringify(currentSelections) !== JSON.stringify(nextSelections) ||
        input.stages.some((stage, order) => {
          const current = existing.stages[order];
          return (
            !current ||
            stage.plannedStart !== current.plannedStart.toISOString().slice(0, 10) ||
            stage.plannedEnd !== current.plannedEnd.toISOString().slice(0, 10) ||
            stage.owner !== current.owner ||
            stage.notes !== current.notes
          );
        });
      if (structuralChange) {
        throw new ApiError(
          "ACTIVE_PLAN_FIELD_LOCKED",
          "进行中的计划只能修改名称、总责任人、主导部门和补充要求；节点请使用专用操作",
          409,
        );
      }
    }

    const inspectionItems = await db.inspectionItem.findMany({
      where: {
        id: { in: input.inspectionItemSelections.map((item) => item.inspectionItemId) },
        active: true,
      },
    });
    if (inspectionItems.length !== input.inspectionItemSelections.length) {
      throw new ApiError("INVALID_INSPECTION_ITEM", "检查项目不存在或已停用", 422);
    }
    const before = serializeUpgradePlan(existing);
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.upgradePlan.updateMany({
        where: { id, version: input.expectedVersion, lifecycleStatus: existing.lifecycleStatus },
        data: {
          title: input.title,
          overallOwner: input.overallOwner,
          leadDepartment: input.leadDepartment,
          supplementalRequirements: input.supplementalRequirements,
          ...(existing.lifecycleStatus === "ACTIVE"
            ? {}
            : {
                pilotId: input.pilotId,
                type: input.type.toUpperCase() as typeof existing.type,
                startDate: new Date(`${input.startDate}T00:00:00.000Z`),
                endDate: new Date(`${input.endDate}T00:00:00.000Z`),
              }),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ApiError("VERSION_CONFLICT", "升级计划已被其他操作更新", 409);
      }
      if (existing.lifecycleStatus !== "ACTIVE") {
        for (const [order, stage] of input.stages.entries()) {
          await tx.upgradeStage.update({
            where: { id: existing.stages[order]!.id },
            data: {
              plannedStart: new Date(`${stage.plannedStart}T00:00:00.000Z`),
              plannedEnd: new Date(`${stage.plannedEnd}T00:00:00.000Z`),
              owner: stage.owner,
              notes: stage.notes,
            },
          });
        }
        await tx.upgradePlanInspectionItem.deleteMany({ where: { planId: id } });
        await tx.upgradePlanInspectionItem.createMany({
          data: input.inspectionItemSelections.map((selection) => {
            const definition = inspectionItems.find(
              (item) => item.id === selection.inspectionItemId,
            )!;
            return {
              planId: id,
              inspectionItemId: definition.id,
              stageId: existing.stages[selection.stageOrder]!.id,
              nameSnapshot: definition.name,
              ruleVersionSnapshot: definition.ruleVersion,
              ruleSnapshot: definition.rule as never,
            };
          }),
        });
      }
      const after = await tx.upgradePlan.findUniqueOrThrow({ where: { id }, include: includePlan });
      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          actorId: admin.id,
          pilotId: after.pilotId,
          action: "upgrade_plan.updated",
          entityType: "UpgradePlan",
          entityId: id,
          detail: { before, after: serializeUpgradePlan(after) },
          requestId,
        },
      });
      return after;
    });
    return jsonData(serializeUpgradePlan(result), requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
