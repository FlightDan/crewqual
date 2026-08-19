import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";
import { mapReview } from "@/server/admin-repository";
import { deriveQualificationDateState } from "@/lib/qualification-date-status";
import { relatedPilotUnitWhere } from "@/server/admin-permissions";
import { pilotRoleLabel, upgradeStageLabel } from "@/lib/domain-i18n";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "dashboard.read");
    const db = getPrisma();
    const scope = relatedPilotUnitWhere(admin);
    const activeQualifications = db.qualificationRecord.findMany({
      where: { status: "ACTIVE", ...scope },
      include: { pilot: true, qualificationType: true },
    });
    const now = new Date();
    const shanghaiNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const mondayOffset = (shanghaiNow.getUTCDay() + 6) % 7;
    const weekStartShanghai = new Date(
      Date.UTC(
        shanghaiNow.getUTCFullYear(),
        shanghaiNow.getUTCMonth(),
        shanghaiNow.getUTCDate() - mondayOffset,
      ),
    );
    const weekStart = new Date(weekStartShanghai.getTime() - 8 * 60 * 60 * 1000);
    const weekEnd = new Date(weekStart.getTime() + 7 * 86400000 - 1);
    const [activeRecords, pendingReviewCount, pendingReviews, weeklyStages, delayedStages] =
      await Promise.all([
        activeQualifications,
        db.qualificationUpdateRequest.count({ where: { status: "PENDING", ...scope } }),
        db.qualificationUpdateRequest.findMany({
          where: { status: "PENDING", ...scope },
          include: {
            pilot: true,
            qualificationType: true,
            verifications: { orderBy: { createdAt: "desc" }, take: 1 },
          },
          orderBy: { submittedAt: "asc" },
        }),
        db.upgradeStage.findMany({
          where: {
            plannedStart: { gte: weekStart, lte: weekEnd },
            plan: { lifecycleStatus: { not: "CANCELLED" }, ...scope },
          },
          include: { plan: { include: { pilot: true } } },
          orderBy: { plannedStart: "asc" },
        }),
        db.upgradeStage.findMany({
          where: {
            status: "DELAYED",
            plan: {
              lifecycleStatus: { not: "CANCELLED" },
              ...scope,
            },
          },
          include: { plan: { include: { pilot: true } } },
          orderBy: { plannedStart: "asc" },
        }),
      ]);
    const dateStates = activeRecords.map((record) =>
      deriveQualificationDateState(record.expiryDate?.toISOString().slice(0, 10) ?? ""),
    );
    const qualificationAlerts = activeRecords
      .map((record) => {
        const expiry = record.expiryDate?.toISOString().slice(0, 10) ?? "";
        const state = deriveQualificationDateState(expiry);
        return {
          pilotId: record.pilotId,
          pilotName: record.pilot.displayName,
          qualification: {
            id: record.qualificationType.code,
            name: record.qualificationType.name,
            expiresOn: expiry,
            status: state.status,
            statusLabel: state.statusLabel,
            remainingLabel: state.remainingLabel,
            parameter: record.levelOrParameter,
          },
          daysRemaining: state.daysRemaining,
        };
      })
      .filter((item) => item.daysRemaining <= 30)
      .sort((a, b) => a.daysRemaining - b.daysRemaining)
      .map(({ pilotId, pilotName, qualification, daysRemaining }) => ({
        pilotId,
        pilotName,
        qualification,
        daysRemaining,
      }));
    const mapUpgradeItem = (stage: (typeof weeklyStages)[number]) => ({
      planId: stage.plan.id,
      pilotId: stage.plan.pilotId,
      pilotName: stage.plan.pilot.displayName,
      role: pilotRoleLabel(stage.plan.pilot.roleCode),
      planTitle: stage.plan.title,
      stage: {
        id: stage.id,
        code: stage.code,
        name: upgradeStageLabel(stage.code, "zh-CN", stage.order),
        status: stage.status.toLowerCase(),
        plannedStart: stage.plannedStart.toISOString().slice(0, 10),
        plannedEnd: stage.plannedEnd.toISOString().slice(0, 10),
        owner: stage.owner,
        notes: stage.notes,
        ...(stage.completedOn ? { completedOn: stage.completedOn.toISOString().slice(0, 10) } : {}),
        ...(stage.resultSummary ? { resultSummary: stage.resultSummary } : {}),
        ...(stage.delayDays == null ? {} : { delayDays: stage.delayDays }),
      },
    });
    const weeklyUpgrades = weeklyStages.map(mapUpgradeItem);
    const delayedUpgrades = delayedStages.map(mapUpgradeItem);
    return jsonData(
      {
        expiredCount: dateStates.filter((state) => state.daysRemaining < 0).length,
        dueIn7DaysCount: dateStates.filter(
          (state) => state.daysRemaining >= 0 && state.daysRemaining <= 7,
        ).length,
        dueIn30DaysCount: dateStates.filter(
          (state) => state.daysRemaining >= 0 && state.daysRemaining <= 30,
        ).length,
        pendingReviewCount,
        weeklyUpgradeCount: weeklyUpgrades.length,
        delayedUpgradeCount: delayedUpgrades.length,
        pendingReviews: pendingReviews.map(mapReview),
        qualificationAlerts,
        weeklyUpgrades,
        delayedUpgrades,
      },
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId);
  }
}
