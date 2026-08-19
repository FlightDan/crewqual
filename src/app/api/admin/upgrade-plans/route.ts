import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
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
import { emitPilotNotification } from "@/server/notifications";
import { UPGRADE_STAGE_CODES } from "@/types/services";
import { serializeUpgradePlan } from "@/server/serializers";
import { pilotUnitWhere, relatedPilotUnitWhere } from "@/server/admin-permissions";
import { upgradePlanDraftSchema } from "@/lib/admin-operations-validation";
import {
  ACTIVE_UPGRADE_PLAN_STATUSES,
  assertCoreQualificationsEligible,
  assertUpgradePlanEligibility,
} from "@/server/upgrade-plan-rules";
/* eslint-disable @typescript-eslint/no-explicit-any */

const draftSchema = z
  .object({
    action: z.enum(["save", "start"]).default("save"),
  })
  .and(upgradePlanDraftSchema);

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "operations.read");
    const url = new URL(request.url);
    const query = z
      .object({
        page: z.string().regex(/^\d+$/).optional(),
        pageSize: z.string().regex(/^\d+$/).optional(),
        status: z
          .enum(["all", "draft", "not_started", "active", "paused", "completed", "cancelled"])
          .optional(),
        type: z
          .enum([
            "all",
            "captain_upgrade",
            "level_upgrade",
            "qualification_recovery",
            "instructor_upgrade",
            "type_rating",
          ])
          .optional(),
        q: z.string().trim().max(256).optional(),
        owner: z.string().trim().max(128).optional(),
        positions: z.string().trim().max(512).optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
      })
      .parse(Object.fromEntries(url.searchParams.entries()));
    const parsedPage = Number(query.page ?? 1);
    const parsedPageSize = Number(query.pageSize ?? 20);
    const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const pageSize =
      Number.isInteger(parsedPageSize) && parsedPageSize > 0 ? Math.min(100, parsedPageSize) : 20;
    const where: any = {
      ...relatedPilotUnitWhere(admin),
      ...(query.status && query.status !== "all"
        ? { lifecycleStatus: query.status.toUpperCase() }
        : {}),
      ...(query.q ? { title: { contains: query.q, mode: "insensitive" } } : {}),
      ...(query.type && query.type !== "all" ? { type: query.type.toUpperCase() } : {}),
      ...(query.owner ? { overallOwner: { contains: query.owner, mode: "insensitive" } } : {}),
      ...(query.positions
        ? {
            positionCodeSnapshot: {
              in: query.positions
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            },
          }
        : {}),
      ...(query.from || query.to
        ? {
            OR: [
              {
                startDate: {
                  ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
                  ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
                },
              },
              {
                endDate: {
                  ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
                  ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
                },
              },
            ],
          }
        : {}),
    };
    const db = getPrisma();
    const [total, items] = await Promise.all([
      db.upgradePlan.count({ where }),
      db.upgradePlan.findMany({
        where,
        include: { stages: true, inspectionItems: { include: { stage: true } } },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return jsonData(
      {
        items: items.map(serializeUpgradePlan),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "operations.write", true);
    const input = await parseJson(request, draftSchema);
    const targetPilot = await getPrisma().pilot.findFirst({
      where: { id: input.pilotId, ...pilotUnitWhere(admin) },
      include: {
        qualifications: { where: { status: "ACTIVE" }, include: { qualificationType: true } },
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
    if (!targetPilot) throw new ApiError("NOT_FOUND", "飞行员不存在", 404);
    const db = getPrisma();
    const inspectionItems = await db.inspectionItem.findMany({
      where: {
        id: { in: input.inspectionItemSelections.map((item) => item.inspectionItemId) },
        active: true,
      },
    });
    if (inspectionItems.length !== input.inspectionItemSelections.length) {
      throw new ApiError("INVALID_INSPECTION_ITEM", "检查项目不存在或已停用", 422);
    }
    const primaryPositionAssignment =
      targetPilot.person?.positionAssignments.find(
        (assignment) => assignment.position?.code === "PILOT",
      ) ?? targetPilot.person?.positionAssignments[0];
    if (input.action === "start") {
      const conflict = await getPrisma().upgradePlan.findFirst({
        where: {
          pilotId: input.pilotId,
          lifecycleStatus: {
            in: ACTIVE_UPGRADE_PLAN_STATUSES.map((status) => status.toUpperCase()) as any,
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
      const coreTypes = await db.qualificationType.findMany({
        where: { core: true, active: true },
        select: { id: true, name: true },
      });
      if (primaryPositionAssignment?.id && targetPilot.personId) {
        await assertUpgradePlanEligibility(db, {
          personId: targetPilot.personId,
          positionAssignmentId: primaryPositionAssignment.id,
        });
      } else {
        assertCoreQualificationsEligible(coreTypes, targetPilot.qualifications);
      }
    }
    const plan = await getPrisma().$transaction(async (tx) => {
      if (input.action === "start") {
        const concurrentConflict = await tx.upgradePlan.findFirst({
          where: {
            pilotId: input.pilotId,
            lifecycleStatus: {
              in: ACTIVE_UPGRADE_PLAN_STATUSES.map((item) => item.toUpperCase()) as any,
            },
          },
          select: { planNumber: true },
        });
        if (concurrentConflict) {
          throw new ApiError(
            "ACTIVE_PLAN_CONFLICT",
            `该飞行员已有活动计划：${concurrentConflict.planNumber}`,
            409,
          );
        }
      }
      const created = await tx.upgradePlan.create({
        data: {
          planNumber: `UP-${randomUUID().slice(0, 8).toUpperCase()}`,
          pilotId: input.pilotId,
          personId: targetPilot.personId ?? undefined,
          positionAssignmentId: primaryPositionAssignment?.id,
          positionCodeSnapshot:
            primaryPositionAssignment?.position?.code ??
            primaryPositionAssignment?.positionCodeSnapshot ??
            "PILOT",
          positionNameSnapshot:
            primaryPositionAssignment?.position?.name ??
            primaryPositionAssignment?.positionNameSnapshot ??
            "飞行员",
          title: input.title,
          type: input.type.toUpperCase() as any,
          lifecycleStatus: input.action === "start" ? "ACTIVE" : "DRAFT",
          startDate: new Date(`${input.startDate}T00:00:00.000Z`),
          endDate: new Date(`${input.endDate}T00:00:00.000Z`),
          overallOwner: input.overallOwner,
          leadDepartment: input.leadDepartment,
          supplementalRequirements: input.supplementalRequirements,
          stages: {
            create: input.stages.map((stage, order) => ({
              order,
              code: UPGRADE_STAGE_CODES[order]!,
              status: input.action === "start" && order === 0 ? "SCHEDULED" : "NOT_STARTED",
              plannedStart: new Date(`${stage.plannedStart}T00:00:00.000Z`),
              plannedEnd: new Date(`${stage.plannedEnd}T00:00:00.000Z`),
              owner: stage.owner,
              notes: stage.notes,
            })),
          },
        },
        include: { stages: true },
      });
      if (input.action === "start") {
        await assertUpgradePlanEligibility(tx, {
          personId: targetPilot.personId,
          positionAssignmentId: primaryPositionAssignment?.id,
        });
      }
      await tx.upgradePlanInspectionItem.createMany({
        data: input.inspectionItemSelections.map((selection) => {
          const definition = inspectionItems.find(
            (item) => item.id === selection.inspectionItemId,
          )!;
          return {
            planId: created.id,
            inspectionItemId: definition.id,
            stageId: created.stages.find((stage) => stage.order === selection.stageOrder)!.id,
            nameSnapshot: definition.name,
            ruleVersionSnapshot: definition.ruleVersion,
            ruleSnapshot: definition.rule as never,
          };
        }),
      });
      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          actorId: admin.id,
          pilotId: input.pilotId,
          action:
            input.action === "start" ? "upgrade_plan.created_started" : "upgrade_plan.created",
          entityType: "UpgradePlan",
          entityId: created.id,
          detail: { title: input.title },
          requestId,
        },
      });
      if (input.action === "start") {
        await emitPilotNotification(tx, {
          eventKey: `upgrade-created:${created.id}:1`,
          pilotId: input.pilotId,
          type: "upgrade_created",
          templateKey: "upgrade.plan.created",
          templateParams: { planTitle: input.title },
        });
      }
      return tx.upgradePlan.findUniqueOrThrow({
        where: { id: created.id },
        include: { stages: true, inspectionItems: { include: { stage: true } } },
      });
    });
    return jsonData(serializeUpgradePlan(plan), requestId, 201);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
