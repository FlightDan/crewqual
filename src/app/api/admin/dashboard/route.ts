import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";
import { mapReview } from "@/server/admin-repository";
import { fixedClock } from "@/lib/qualification-date-status";
import {
  pilotQualificationInclude,
  pilotQualificationStates,
  qualificationTranslations,
} from "@/server/pilot-qualifications";
import { pilotUnitWhere, relatedPilotUnitWhere } from "@/server/admin-permissions";
import { pilotRoleLabel, upgradeStageLabel } from "@/lib/domain-i18n";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "dashboard.read");
    const db = getPrisma();
    const scope = relatedPilotUnitWhere(admin);
    const clock = fixedClock();
    const activeQualifications = db.pilot.findMany({
      where: { active: true, ...pilotUnitWhere(admin) },
      include: pilotQualificationInclude,
    });
    const now = clock.now();
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
    const [holders, pendingReviewCount, pendingReviews, weeklyStages, delayedStages] =
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
    const holdersWithState = holders.map((pilot) => ({
      pilot,
      ...pilotQualificationStates(pilot, clock),
    }));
    const entries = holdersWithState.flatMap(({ pilot, items }) =>
      items.map((item) => ({ pilot, ...item })),
    );
    const dateStates = entries.map((item) => item.state);
    const qualificationAlerts = entries
      .flatMap((item) => {
        const state = item.state;
        if (
          state.daysRemaining === null ||
          state.daysRemaining > 30 ||
          state.status === "incomplete" ||
          state.status === "missing"
        )
          return [];
        return [
          {
            pilotId: item.pilot.id,
            pilotName: item.pilot.displayName,
            qualification: {
              id: item.code,
              name: item.name,
              translations: qualificationTranslations(item.translations),
              expiresOn: item.record?.expiryDate?.toISOString().slice(0, 10) ?? "",
              ...state,
              parameter: item.record?.levelOrParameter,
              required: item.required,
            },
            daysRemaining: state.daysRemaining,
          },
        ];
      })
      .sort((a, b) => a.daysRemaining - b.daysRemaining);
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
        timezones: [
          ...new Set(
            holdersWithState
              .map((holder) => holder.timezone)
              .filter((zone): zone is string => Boolean(zone)),
          ),
        ],
        evaluatedAt: clock.now().toISOString(),
        missingCount: entries.filter((item) => item.required && item.state.status === "missing")
          .length,
        incompleteCount: entries.filter(
          (item) => item.required && item.state.status === "incomplete",
        ).length,
        expiredCount: dateStates.filter((state) => state.status === "expired").length,
        dueIn7DaysCount: dateStates.filter(
          (state) =>
            state.daysRemaining !== null && state.daysRemaining >= 0 && state.daysRemaining <= 7,
        ).length,
        dueIn30DaysCount: dateStates.filter(
          (state) =>
            state.daysRemaining !== null && state.daysRemaining >= 0 && state.daysRemaining <= 30,
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
