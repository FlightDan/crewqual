import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";
import { mapReview } from "@/server/admin-repository";
import { deriveQualificationDateState } from "@/lib/qualification-date-status";
import { relatedPilotUnitWhere } from "@/server/admin-permissions";

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
    const [activeRecords, pendingReviewCount, delayedUpgradeCount, pendingReviews, weeklyStages] =
      await Promise.all([
        activeQualifications,
        db.qualificationUpdateRequest.count({ where: { status: "PENDING", ...scope } }),
        db.upgradePlan.count({
          where: {
            lifecycleStatus: "ACTIVE",
            stages: { some: { status: "DELAYED" } },
            ...scope,
          },
        }),
        db.qualificationUpdateRequest.findMany({
          where: { status: "PENDING", ...scope },
          include: {
            pilot: true,
            qualificationType: true,
            verifications: { orderBy: { createdAt: "desc" }, take: 1 },
          },
          orderBy: { submittedAt: "asc" },
          take: 5,
        }),
        db.upgradeStage.findMany({
          where: {
            plannedStart: { gte: weekStart, lte: weekEnd },
            plan: { lifecycleStatus: { not: "CANCELLED" }, ...scope },
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
      .map(({ pilotId, pilotName, qualification }) => ({ pilotId, pilotName, qualification }));
    const weeklyUpgrades = weeklyStages.map((stage) => ({
      pilotId: stage.plan.pilotId,
      pilotName: stage.plan.pilot.displayName,
      role: stage.plan.pilot.role,
      planTitle: stage.plan.title,
      stage: {
        id: stage.id,
        name: stage.name,
        status: stage.status.toLowerCase(),
        plannedStart: stage.plannedStart.toISOString().slice(0, 10),
        plannedEnd: stage.plannedEnd.toISOString().slice(0, 10),
        owner: stage.owner,
        notes: stage.notes,
        ...(stage.completedOn ? { completedOn: stage.completedOn.toISOString().slice(0, 10) } : {}),
        ...(stage.resultSummary ? { resultSummary: stage.resultSummary } : {}),
        ...(stage.delayDays == null ? {} : { delayDays: stage.delayDays }),
      },
    }));
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
        delayedUpgradeCount,
        pendingReviews: pendingReviews.map(mapReview),
        qualificationAlerts,
        weeklyUpgrades,
      },
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId);
  }
}
