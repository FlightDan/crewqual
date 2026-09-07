import { ApiError } from "@/server/api";
import type { UpgradePlanLifecycleStatus, UpgradePlanStageRecord } from "@/types/services";
import { dateOnlyForTimezone } from "@/lib/date-only";
import { evaluateStoredQualification } from "@/lib/qualification-date-status";
import { memberQualificationTimezone } from "@/lib/qualification-timezone";
import type { UpgradePlanStatus } from "@/generated/prisma/enums";
/* eslint-disable @typescript-eslint/no-explicit-any */

export const ACTIVE_UPGRADE_PLAN_STATUSES: UpgradePlanLifecycleStatus[] = [
  "not_started",
  "active",
  "paused",
];

/** Any unfinished plan keeps its position assignment in use. */
export const UPGRADE_PLAN_STATUSES_BLOCKING_ASSIGNMENT_END: UpgradePlanStatus[] = [
  "DRAFT",
  "NOT_STARTED",
  "ACTIVE",
  "PAUSED",
];

/**
 * Serialize assignment-ending and plan-start transitions on the same row.
 * Prisma does not expose row locks through the model API, so keep this small
 * and parameterized query as the shared lock primitive for both code paths.
 */
export async function lockPositionAssignment(db: any, assignmentId: string) {
  await db.$queryRaw`
    SELECT "id"
    FROM "PersonPositionAssignment"
    WHERE "id" = ${assignmentId}
    FOR UPDATE
  `;
}

export function upgradePlanAssociationMode(plan: {
  personId?: string | null;
  positionAssignmentId?: string | null;
}): "canonical" | "legacy" {
  const hasPerson = Boolean(plan.personId);
  const hasAssignment = Boolean(plan.positionAssignmentId);
  if (hasPerson !== hasAssignment) {
    throw new ApiError("PLAN_SCOPE_MISMATCH", "升级计划人员与职位分配关联不完整", 409);
  }
  return hasPerson ? "canonical" : "legacy";
}

export function assertCoreQualificationsEligible(
  coreTypes: Array<{ id: string; name: string }>,
  activeRecords: Array<{
    qualificationTypeId: string;
    expiryDate: Date | null;
    qualificationRuleSnapshot: unknown;
  }>,
  timezone: string | null = "Asia/Shanghai",
  now = new Date(),
) {
  const records = new Map(activeRecords.map((record) => [record.qualificationTypeId, record]));
  const missing = coreTypes.filter((type) => !records.has(type.id));
  if (missing.length) {
    throw new ApiError(
      "MISSING_CORE_QUALIFICATION",
      `缺少核心资质：${missing.map((item) => item.name).join("、")}`,
      409,
    );
  }
  const states = new Map(
    coreTypes.map((type) => [
      type.id,
      evaluateStoredQualification(records.get(type.id), { now: () => now }, timezone),
    ]),
  );
  const incomplete = coreTypes.filter((type) => states.get(type.id)?.status === "incomplete");
  if (incomplete.length) {
    throw new ApiError(
      "INCOMPLETE_CORE_QUALIFICATION",
      `核心资质数据不完整，请人工核查：${incomplete.map((item) => item.name).join("、")}`,
      409,
    );
  }
  const expired = coreTypes.filter((type) => states.get(type.id)?.status === "expired");
  if (expired.length) {
    throw new ApiError(
      "EXPIRED_CORE_QUALIFICATION",
      `核心资质已过期：${expired.map((item) => item.name).join("、")}`,
      409,
    );
  }
}

/**
 * Canonical eligibility shared by create/start/resume.  Legacy plans without
 * a Person/position assignment continue through the compatibility check in
 * the route, but any canonical plan is evaluated exclusively against the
 * saved assignment and QualificationDefinition requirements.
 */
export async function assertUpgradePlanEligibility(
  db: any,
  plan: { personId?: string | null; positionAssignmentId?: string | null },
  now = new Date(),
) {
  if (upgradePlanAssociationMode(plan) === "legacy") return;
  const assignment = await db.personPositionAssignment.findUnique({
    where: { id: plan.positionAssignmentId! },
    include: {
      position: {
        include: {
          requirements: {
            where: { active: true, required: true, upgradePrerequisite: true },
            include: { qualificationDefinition: true },
          },
        },
      },
      person: { include: { unit: true, legacyPilot: { include: { unit: true } } } },
    },
  });
  if (!assignment || assignment.personId !== plan.personId) {
    throw new ApiError("PLAN_SCOPE_MISMATCH", "升级计划人员与职位分配不一致", 409);
  }
  const timezone = assignment.person ? memberQualificationTimezone(assignment.person) : null;
  if (!timezone)
    throw new ApiError(
      "INCOMPLETE_CORE_QUALIFICATION",
      "人员单位或时区数据不完整，请人工核查",
      409,
    );
  const today = dateOnlyForTimezone(now, timezone);
  const effectiveFrom = assignment.effectiveFrom.toISOString().slice(0, 10);
  const effectiveTo = assignment.effectiveTo?.toISOString().slice(0, 10) ?? null;
  if (assignment.status !== "ACTIVE") {
    throw new ApiError(
      "POSITION_ASSIGNMENT_INACTIVE",
      "任职记录不是 ACTIVE 状态，不能启动升级计划",
      409,
    );
  }
  if (effectiveFrom > today || (effectiveTo !== null && effectiveTo < today)) {
    throw new ApiError(
      "POSITION_ASSIGNMENT_NOT_EFFECTIVE",
      "任职记录当前不在生效日期内，不能启动升级计划",
      409,
    );
  }
  const requirements = assignment.position?.requirements ?? [];
  if (!requirements.length) return;
  const records = await db.qualificationRecord.findMany({
    where: {
      personId: plan.personId,
      status: "ACTIVE",
      qualificationDefinitionId: {
        in: requirements.map((item: any) => item.qualificationDefinitionId),
      },
    },
    select: { qualificationDefinitionId: true, expiryDate: true, qualificationRuleSnapshot: true },
  });
  assertCoreQualificationsEligible(
    requirements.map((item: any) => ({
      id: item.qualificationDefinitionId,
      name: item.qualificationDefinition.name,
    })),
    records
      .filter((item: any) => Boolean(item.qualificationDefinitionId))
      .map((item: any) => ({
        qualificationTypeId: item.qualificationDefinitionId,
        expiryDate: item.expiryDate,
        qualificationRuleSnapshot: item.qualificationRuleSnapshot,
      })),
    timezone,
    now,
  );
}

export function assertLifecycleAction(
  status: UpgradePlanLifecycleStatus,
  action: "start" | "pause" | "resume" | "cancel",
  reason?: string,
) {
  const allowed: Record<typeof action, UpgradePlanLifecycleStatus[]> = {
    start: ["draft", "not_started"],
    pause: ["active"],
    resume: ["paused"],
    cancel: ["draft", "not_started", "active", "paused"],
  };
  if (!allowed[action].includes(status)) {
    throw new ApiError("INVALID_PLAN_STATE", `当前状态不可执行${action}`, 409);
  }
  if (action === "cancel" && (!reason || reason.trim().length < 5)) {
    throw new ApiError("VALIDATION_ERROR", "取消原因至少需要 5 个字符", 422, {
      reason: ["取消原因至少需要 5 个字符"],
    });
  }
}

export function assertStageDates(
  plan: { startDate: string; endDate: string },
  stages: Array<Pick<UpgradePlanStageRecord, "plannedStart" | "plannedEnd">>,
  index: number,
  plannedStart: string,
  plannedEnd: string,
) {
  if (plannedEnd < plannedStart) {
    throw new ApiError("VALIDATION_ERROR", "节点结束日期不得早于开始日期", 422, {
      plannedEnd: ["节点结束日期不得早于开始日期"],
    });
  }
  if (plannedStart < plan.startDate || plannedEnd > plan.endDate) {
    throw new ApiError("VALIDATION_ERROR", "节点日期必须位于整体计划周期内", 422, {
      plannedStart: ["节点日期必须位于整体计划周期内"],
    });
  }
  if (index > 0 && plannedStart < stages[index - 1]!.plannedEnd) {
    throw new ApiError("VALIDATION_ERROR", "节点日期不得早于前一固定顺序节点", 422, {
      plannedStart: ["节点日期不得早于前一固定顺序节点"],
    });
  }
  if (index < stages.length - 1 && plannedEnd > stages[index + 1]!.plannedStart) {
    throw new ApiError("VALIDATION_ERROR", "节点日期不得晚于后一固定顺序节点", 422, {
      plannedEnd: ["节点日期不得晚于后一固定顺序节点"],
    });
  }
}

export function assertStageCanComplete(
  lifecycleStatus: UpgradePlanLifecycleStatus,
  stages: Array<Pick<UpgradePlanStageRecord, "status">>,
  index: number,
  completedOn: string,
  plan: Pick<UpgradePlanRecordForRules, "startDate" | "endDate">,
) {
  if (lifecycleStatus !== "active") {
    throw new ApiError("INVALID_PLAN_STATE", "仅进行中的计划可以登记节点完成", 409);
  }
  const current = stages[index];
  if (!current) throw new ApiError("NOT_FOUND", "升级节点不存在", 404);
  if (current.status === "completed") {
    throw new ApiError("INVALID_STAGE_STATE", "该节点已经完成，不能重复登记", 409);
  }
  if (stages.slice(0, index).some((stage) => stage.status !== "completed")) {
    throw new ApiError("INVALID_STAGE_ORDER", "不能跳过尚未完成的中间节点", 409);
  }
  if (!["scheduled", "in_progress", "delayed"].includes(current.status)) {
    throw new ApiError("INVALID_STAGE_STATE", "当前节点尚未进入可完成状态", 409);
  }
  if (completedOn < plan.startDate || completedOn > plan.endDate) {
    throw new ApiError("VALIDATION_ERROR", "完成日期必须位于整体计划周期内", 422, {
      completedOn: ["完成日期必须位于整体计划周期内"],
    });
  }
}

type UpgradePlanRecordForRules = { startDate: string; endDate: string };
