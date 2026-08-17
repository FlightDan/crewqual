import { ApiError } from "@/server/api";
import type { UpgradePlanLifecycleStatus, UpgradePlanStageRecord } from "@/types/services";
import { deriveQualificationDateState } from "@/lib/qualification-date-status";

export const ACTIVE_UPGRADE_PLAN_STATUSES: UpgradePlanLifecycleStatus[] = [
  "not_started",
  "active",
  "paused",
];

export function assertCoreQualificationsEligible(
  coreTypes: Array<{ id: string; name: string }>,
  activeRecords: Array<{ qualificationTypeId: string; expiryDate: Date | null }>,
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
  const expired = coreTypes.filter((type) => {
    const record = records.get(type.id)!;
    return (
      deriveQualificationDateState(record.expiryDate?.toISOString().slice(0, 10) ?? "").status ===
      "expired"
    );
  });
  if (expired.length) {
    throw new ApiError(
      "EXPIRED_CORE_QUALIFICATION",
      `核心资质已过期：${expired.map((item) => item.name).join("、")}`,
      409,
    );
  }
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
    cancel: ["not_started", "active", "paused"],
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
