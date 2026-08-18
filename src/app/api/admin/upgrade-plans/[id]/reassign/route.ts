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
import { getPrisma } from "@/server/prisma";
import { relatedPilotUnitWhere, pilotUnitWhere, isSuperAdmin } from "@/server/admin-permissions";
import { serializeUpgradePlan } from "@/server/serializers";

const schema = z.object({
  pilotId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(5).max(1000),
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "operations.write", true);
    const { id } = await context.params;
    const input = await parseJson(request, schema);
    const db = getPrisma();
    const plan = await db.upgradePlan.findFirst({
      where: { id, ...relatedPilotUnitWhere(admin) },
      include: {
        pilot: { include: { unit: true } },
        stages: true,
      },
    });
    if (!plan) throw new ApiError("NOT_FOUND", "升级计划不存在", 404);
    if (!["DRAFT", "NOT_STARTED"].includes(plan.lifecycleStatus)) {
      throw new ApiError("PLAN_REASSIGN_LOCKED", "只有草稿或未开始计划可以重新分配人员", 409);
    }
    const target = await db.pilot.findFirst({
      where: { id: input.pilotId, active: true, ...pilotUnitWhere(admin) },
      include: {
        unit: true,
        person: {
          include: {
            positionAssignments: {
              where: { status: "ACTIVE" },
              include: { position: true },
              orderBy: { isPrimary: "desc" },
            },
          },
        },
      },
    });
    if (!target) throw new ApiError("NOT_FOUND", "目标人员不存在", 404);
    if (isSuperAdmin(admin) && target.unit.organizationId !== plan.pilot.unit.organizationId) {
      throw new ApiError("CROSS_ORGANIZATION_REASSIGN", "不能跨组织重新分配升级计划", 403);
    }
    const position = target.person?.positionAssignments[0];
    if (!target.person || !position) {
      throw new ApiError("POSITION_REQUIRED", "目标人员尚未配置有效职位", 422);
    }
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.upgradePlan.updateMany({
        where: { id, version: input.expectedVersion, lifecycleStatus: plan.lifecycleStatus },
        data: {
          pilotId: target.id,
          personId: target.person!.id,
          positionAssignmentId: position.id,
          positionCodeSnapshot: position.position?.code ?? position.positionCodeSnapshot,
          positionNameSnapshot: position.position?.name ?? position.positionNameSnapshot,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new ApiError("VERSION_CONFLICT", "升级计划已被更新", 409);
      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          actorId: admin.id,
          pilotId: target.id,
          personId: target.person!.id,
          action: "upgrade_plan.reassigned",
          entityType: "UpgradePlan",
          entityId: id,
          detail: { fromPilotId: plan.pilotId, toPilotId: target.id, reason: input.reason },
          requestId,
        },
      });
      return tx.upgradePlan.findUniqueOrThrow({
        where: { id },
        include: { stages: true, inspectionItems: { include: { stage: true } } },
      });
    });
    return jsonData(serializeUpgradePlan(result), requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
