import { pilotQualificationTimezone } from "@/lib/qualification-timezone";
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
import { serializeUpgradePlan } from "@/server/serializers";
import { relatedPilotUnitWhere } from "@/server/admin-permissions";
import {
  ACTIVE_UPGRADE_PLAN_STATUSES,
  assertCoreQualificationsEligible,
  assertUpgradePlanEligibility,
  assertLifecycleAction,
  lockPositionAssignment,
  upgradePlanAssociationMode,
} from "@/server/upgrade-plan-rules";
import { emitPilotNotification } from "@/server/notifications";
/* eslint-disable @typescript-eslint/no-explicit-any */

const schema = z.object({
  expectedVersion: z.number().int().nonnegative().optional(),
  reason: z.string().optional(),
});
const statuses: Record<string, string> = {
  start: "ACTIVE",
  pause: "PAUSED",
  resume: "ACTIVE",
  cancel: "CANCELLED",
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; action: string }> },
) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "operations.write", true);
    const { id, action } = await context.params;
    const input = await parseJson(request, schema);
    const status = statuses[action];
    if (!status) throw new Error("Unknown action");
    const db = getPrisma();
    const visiblePlan = await db.upgradePlan.findFirst({
      where: { id, ...relatedPilotUnitWhere(admin) },
      include: {
        stages: { orderBy: { order: "asc" } },
        pilot: {
          include: {
            unit: true,
            person: { include: { unit: true } },
            qualifications: { where: { status: "ACTIVE" }, include: { qualificationType: true } },
          },
        },
      },
    });
    if (!visiblePlan) throw new ApiError("NOT_FOUND", "升级计划不存在", 404);
    const result = await db.$transaction(async (tx) => {
      // Lock the plan first so a concurrent reassignment cannot change which
      // assignment is being protected between the read and the assignment
      // lock. The assignment-ending path takes the assignment lock too.
      await tx.$queryRaw`
        SELECT "id"
        FROM "UpgradePlan"
        WHERE "id" = ${id}
        FOR UPDATE
      `;
      const currentPlan = await tx.upgradePlan.findFirst({
        where: { id, ...relatedPilotUnitWhere(admin) },
        include: {
          stages: { orderBy: { order: "asc" } },
          pilot: {
            include: {
              unit: true,
              person: { include: { unit: true } },
              qualifications: {
                where: { status: "ACTIVE" },
                include: { qualificationType: true },
              },
            },
          },
        },
      });
      if (!currentPlan) throw new ApiError("NOT_FOUND", "升级计划不存在", 404);
      const currentLifecycleStatus = currentPlan.lifecycleStatus.toLowerCase() as any;
      assertLifecycleAction(
        currentLifecycleStatus,
        action as "start" | "pause" | "resume" | "cancel",
        input.reason,
      );
      if (["start", "resume"].includes(action)) {
        if (upgradePlanAssociationMode(currentPlan) === "canonical") {
          await lockPositionAssignment(tx, currentPlan.positionAssignmentId!);
          // Re-check under the assignment lock so ending the assignment cannot
          // race this lifecycle transition.
          await assertUpgradePlanEligibility(tx, currentPlan);
        } else {
          const coreTypes = await tx.qualificationType.findMany({
            where: { core: true, active: true },
            select: { id: true, name: true },
          });
          assertCoreQualificationsEligible(
            coreTypes,
            currentPlan.pilot.qualifications,
            pilotQualificationTimezone(currentPlan.pilot),
          );
        }
        const conflict = await tx.upgradePlan.findFirst({
          where: {
            pilotId: currentPlan.pilotId,
            id: { not: id },
            lifecycleStatus: {
              in: ACTIVE_UPGRADE_PLAN_STATUSES.map((item) => item.toUpperCase()) as any,
            },
          },
          select: { planNumber: true },
        });
        if (conflict)
          throw new ApiError(
            "ACTIVE_PLAN_CONFLICT",
            `该飞行员已有活动计划：${conflict.planNumber}`,
            409,
          );
      }
      const updated = await tx.upgradePlan.updateMany({
        where: {
          id,
          lifecycleStatus: currentPlan.lifecycleStatus,
          ...(input.expectedVersion === undefined ? {} : { version: input.expectedVersion }),
        },
        data: {
          lifecycleStatus: status as any,
          ...(action === "cancel" ? { cancellationReason: input.reason!.trim() } : {}),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error("VERSION_CONFLICT");
      if (action === "start") {
        const firstStage = currentPlan.stages[0];
        if (firstStage?.status === "NOT_STARTED") {
          await tx.upgradeStage.update({
            where: { id: firstStage.id },
            data: { status: "SCHEDULED" },
          });
        }
      }
      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          actorId: admin.id,
          pilotId: currentPlan.pilotId,
          action: `upgrade_plan.${action}`,
          entityType: "UpgradePlan",
          entityId: id,
          detail: input,
          requestId,
        },
      });
      if (["start", "resume"].includes(action)) {
        await emitPilotNotification(tx, {
          eventKey: `upgrade-${action}:${id}:${currentPlan.version}`,
          pilotId: currentPlan.pilotId,
          type: action === "start" ? "upgrade_created" : "upgrade_resumed",
          templateKey: action === "start" ? "upgrade.plan.started" : "upgrade.plan.resumed",
          templateParams: { planTitle: currentPlan.title },
        });
      }
      return tx.upgradePlan.findUnique({
        where: { id },
        include: { stages: true, inspectionItems: { include: { stage: true } } },
      });
    });
    if (!result) throw new ApiError("NOT_FOUND", "升级计划不存在", 404);
    return jsonData(serializeUpgradePlan(result), requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
