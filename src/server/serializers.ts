/* eslint-disable @typescript-eslint/no-explicit-any */

import { normalizeUpgradeStageCode, upgradeStageLabel } from "@/lib/domain-i18n";
import { renderNotificationContent } from "@/lib/notification-i18n";

const dateOnly = (value: Date | null | undefined) => value?.toISOString().slice(0, 10) ?? "";

export function serializeUpgradePlan(plan: any) {
  const inspectionItems = (plan.inspectionItems ?? []).map((item: any) => ({
    id: item.id,
    inspectionItemId: item.inspectionItemId,
    stageId: item.stageId,
    stageOrder: item.stage?.order ?? item.stageOrder ?? 0,
    name: item.nameSnapshot,
    ruleVersion: item.ruleVersionSnapshot,
    status: String(item.status).toLowerCase(),
    ...(item.completedOn ? { completedOn: dateOnly(item.completedOn) } : {}),
    ...(item.resultSummary ? { resultSummary: item.resultSummary } : {}),
  }));
  return {
    id: plan.id,
    planNumber: plan.planNumber,
    pilotId: plan.pilotId,
    ...(plan.positionCodeSnapshot
      ? {
          positionCode: plan.positionCodeSnapshot,
          positionName: plan.positionNameSnapshot ?? plan.positionCodeSnapshot,
        }
      : {}),
    title: plan.title,
    type: String(plan.type).toLowerCase(),
    lifecycleStatus: String(plan.lifecycleStatus).toLowerCase(),
    startDate: dateOnly(plan.startDate),
    endDate: dateOnly(plan.endDate),
    overallOwner: plan.overallOwner,
    leadDepartment: plan.leadDepartment,
    supplementalRequirements: Array.isArray(plan.supplementalRequirements)
      ? plan.supplementalRequirements
      : [],
    inspectionItems,
    stages: [...(plan.stages ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((stage) => ({
        id: stage.id,
        code: normalizeUpgradeStageCode(stage.code, stage.order),
        name: upgradeStageLabel(stage.code, "zh-CN", stage.order),
        status: String(stage.status).toLowerCase(),
        plannedStart: dateOnly(stage.plannedStart),
        plannedEnd: dateOnly(stage.plannedEnd),
        owner: stage.owner,
        notes: stage.notes,
        ...(stage.completedOn ? { completedOn: dateOnly(stage.completedOn) } : {}),
        ...(stage.resultSummary ? { resultSummary: stage.resultSummary } : {}),
        ...(stage.delayDays == null ? {} : { delayDays: stage.delayDays }),
        inspectionItems: inspectionItems.filter((item: any) => item.stageId === stage.id),
      })),
    createdAt: plan.createdAt?.toISOString?.() ?? plan.createdAt,
    updatedAt: plan.updatedAt?.toISOString?.() ?? plan.updatedAt,
    ...(plan.cancellationReason ? { cancellationReason: plan.cancellationReason } : {}),
    audit: [],
    version: plan.version,
  };
}

export function serializeQualificationConfig(item: any) {
  return {
    id: item.id,
    qualificationId: item.code,
    code: item.code,
    name: item.name,
    core: item.core,
    active: item.active,
    parameterRestriction: item.parameterRestriction,
    validityRule: item.validityRule,
    reminders: item.reminders,
    ocrChecks: item.ocrChecks,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    version: item.version,
  };
}

export function serializeNotification(item: any) {
  const content = renderNotificationContent(item);
  return {
    id: item.id,
    type: String(item.type).toLowerCase(),
    channel: String(item.channel).toLowerCase(),
    status: String(item.status).toLowerCase(),
    pilotId: item.pilotId ?? undefined,
    pilotName: item.pilot?.displayName ?? "",
    employeeNumber: item.pilot?.employeeNumber,
    target: item.target,
    summary: content.summary,
    message: content.message,
    createdAt: item.createdAt.toISOString(),
    sentAt: item.sentAt?.toISOString(),
    attempts: (item.attempts ?? []).map((attempt: any) => ({
      id: attempt.id,
      attemptedAt: attempt.attemptedAt.toISOString(),
      status: String(attempt.status).toLowerCase(),
      detail: attempt.detail,
      attemptNumber: attempt.attemptNumber,
      errorCategory: attempt.errorCategory ?? undefined,
    })),
    version: item.version,
  };
}
