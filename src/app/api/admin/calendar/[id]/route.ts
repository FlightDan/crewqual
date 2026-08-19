import { NextRequest } from "next/server";
import { ApiError, getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";
import { deriveQualificationDateState } from "@/lib/qualification-date-status";
import { requireAssignedUnit } from "@/server/admin-permissions";
import { upgradeStageLabel } from "@/lib/domain-i18n";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "operations.read");
    const unitId = requireAssignedUnit(admin);
    const id = (await context.params).id;
    const db = getPrisma();
    if (id.startsWith("qualification:")) {
      const record = await db.qualificationRecord.findFirst({
        where: {
          id: id.slice(13),
          status: "ACTIVE",
          ...(unitId ? { pilot: { unitId } } : {}),
        },
        include: {
          pilot: {
            include: {
              unit: true,
              person: {
                include: {
                  positionAssignments: {
                    include: { position: true },
                    orderBy: { status: "asc" },
                  },
                },
              },
            },
          },
          qualificationType: true,
        },
      });
      if (!record?.expiryDate) throw new ApiError("NOT_FOUND", "日历事件不存在", 404);
      return jsonData(
        {
          ...deriveQualificationDateState(record.expiryDate?.toISOString().slice(0, 10) ?? ""),
          id,
          type: "qualification_expiry",
          date: record.expiryDate?.toISOString().slice(0, 10),
          endDate: record.expiryDate?.toISOString().slice(0, 10),
          title: `${record.qualificationType.name}到期`,
          pilotId: record.pilotId,
          pilotName: record.pilot.displayName,
          employeeNumber: record.pilot.employeeNumber,
          unit: record.pilot.unit.name,
          positionCode:
            record.pilot.person?.positionAssignments[0]?.position?.code ??
            record.pilot.person?.positionAssignments[0]?.positionCodeSnapshot ??
            undefined,
          positionName:
            record.pilot.person?.positionAssignments[0]?.position?.name ??
            record.pilot.person?.positionAssignments[0]?.positionNameSnapshot ??
            undefined,
          qualificationId: record.qualificationType.code,
          qualificationName: record.qualificationType.name,
          qualificationValidityRule: record.qualificationType.validityRule,
          qualificationRecord: {
            ...deriveQualificationDateState(record.expiryDate.toISOString().slice(0, 10)),
            recordId: record.id,
            qualificationId: record.qualificationType.code,
            qualificationName: record.qualificationType.name,
            credentialNumber: record.credentialNumber,
            issueDate: record.issueDate.toISOString().slice(0, 10),
            expiryDate: record.expiryDate.toISOString().slice(0, 10),
            issuingAuthority: record.issuingAuthority,
            levelOrParameter: record.levelOrParameter,
            lastVerifiedOn: record.lastVerifiedAt?.toISOString().slice(0, 10) ?? "",
            version: record.version,
          },
          readonly: true,
        },
        requestId,
      );
    }
    const stage = await db.upgradeStage.findFirst({
      where: {
        id: id.replace("stage:", ""),
        ...(unitId ? { plan: { pilot: { unitId } } } : {}),
      },
      include: { plan: { include: { pilot: { include: { unit: true } } } } },
    });
    if (!stage) throw new ApiError("NOT_FOUND", "日历事件不存在", 404);
    const stageName = upgradeStageLabel(stage.code, "zh-CN", stage.order);
    return jsonData(
      {
        id,
        type: "upgrade_stage",
        date: stage.plannedStart.toISOString().slice(0, 10),
        endDate: stage.plannedEnd.toISOString().slice(0, 10),
        title: stageName,
        pilotId: stage.plan.pilotId,
        pilotName: stage.plan.pilot.displayName,
        employeeNumber: stage.plan.pilot.employeeNumber,
        unit: stage.plan.pilot.unit.name,
        positionCode: stage.plan.positionCodeSnapshot ?? undefined,
        positionName: stage.plan.positionNameSnapshot ?? undefined,
        planId: stage.planId,
        planNumber: stage.plan.planNumber,
        planTitle: stage.plan.title,
        planLifecycleStatus: stage.plan.lifecycleStatus.toLowerCase(),
        stageId: stage.id,
        stageCode: stage.code,
        stageName,
        stageStatus: stage.status.toLowerCase(),
        owner: stage.owner,
        notes: stage.notes,
        readonly: ["COMPLETED", "CANCELLED"].includes(stage.plan.lifecycleStatus),
      },
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId);
  }
}
