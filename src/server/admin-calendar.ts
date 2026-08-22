import { shanghaiToday } from "@/lib/calendar-utils";
import { deriveQualificationDateState } from "@/lib/qualification-date-status";
import { requireAssignedUnit } from "@/server/admin-permissions";
import type { AuthenticatedAdmin } from "@/server/auth";
import { getPrisma } from "@/server/prisma";
import { upgradeStageLabel } from "@/lib/domain-i18n";
import {
  CORE_QUALIFICATION_IDS,
  type AdminCalendarEvent,
  type CalendarDayQualificationQuery,
  type CalendarDayQualificationRoster,
  type CalendarQuery,
  type ValidityRule,
} from "@/types/services";
/* eslint-disable @typescript-eslint/no-explicit-any */

const dateOnly = (value: Date | null | undefined) => value?.toISOString().slice(0, 10) ?? "";

function selectedDateClock(date: string) {
  return { now: () => new Date(`${date}T12:00:00+08:00`) };
}

function splitUnits(value?: string) {
  return (value ?? "")
    .split(",")
    .map((unit) => unit.trim())
    .filter(Boolean);
}

function splitCodes(value?: string) {
  return (value ?? "")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

export async function listAdminCalendarEvents(
  admin: AuthenticatedAdmin,
  query: CalendarQuery,
): Promise<AdminCalendarEvent[]> {
  const unitId = requireAssignedUnit(admin);
  const fromValue = query.from ?? shanghaiToday();
  const toValue =
    query.to ??
    new Date(Date.parse(`${fromValue}T00:00:00.000Z`) + 89 * 86400000).toISOString().slice(0, 10);
  const from = new Date(`${fromValue}T00:00:00.000Z`);
  const to = new Date(`${toValue}T23:59:59.999Z`);
  const units = splitUnits(query.units);
  const positionCodes = splitCodes(query.positions);
  const db = getPrisma();
  const positionPilotIds = new Set<string>();
  const positionByPilot = new Map<string, { code: string; name: string }>();
  if (positionCodes.length) {
    const positions = await db.position.findMany({
      where: {
        code: { in: positionCodes },
        active: true,
        ...(unitId ? { organizationId: unitId } : {}),
      },
      select: {
        code: true,
        name: true,
        assignments: {
          where: { status: "ACTIVE" },
          select: { person: { select: { legacyPilot: { select: { id: true } } } } },
        },
      },
    });
    for (const position of positions) {
      for (const assignment of position.assignments) {
        const pilotId = assignment.person.legacyPilot?.id;
        if (pilotId) {
          positionPilotIds.add(pilotId);
          positionByPilot.set(pilotId, { code: position.code, name: position.name });
        }
      }
    }
  }
  const pilotWhere = {
    ...(unitId ? { unitId } : {}),
    ...(units.length ? { unit: { name: { in: units } } } : {}),
    ...(positionCodes.length ? { id: { in: [...positionPilotIds] } } : {}),
  };
  if (positionCodes.length && !positionPilotIds.size) return [];
  const [qualifications, stages] = await Promise.all([
    db.qualificationRecord.findMany({
      where: {
        status: "ACTIVE",
        expiryDate: { gte: from, lte: to },
        pilot: pilotWhere,
      },
      include: { pilot: { include: { unit: true } }, qualificationType: true },
    }),
    db.upgradeStage.findMany({
      where: {
        plannedStart: { lte: to },
        plannedEnd: { gte: from },
        plan: {
          lifecycleStatus: { not: "CANCELLED" },
          pilot: pilotWhere,
        },
      },
      include: {
        inspectionItems: true,
        plan: { include: { pilot: { include: { unit: true } } } },
      },
    }),
  ]);
  const events: AdminCalendarEvent[] = [
    ...qualifications.map((item: any) => ({
      ...deriveQualificationDateState(dateOnly(item.expiryDate)),
      id: `qualification:${item.id}`,
      type: "qualification_expiry" as const,
      date: dateOnly(item.expiryDate),
      endDate: dateOnly(item.expiryDate),
      title: `${item.qualificationType.name}到期`,
      pilotId: item.pilotId,
      pilotName: item.pilot.displayName,
      employeeNumber: item.pilot.employeeNumber,
      unit: item.pilot.unit.name,
      qualificationId: item.qualificationType.code,
      qualificationName: item.qualificationType.name,
      qualificationTranslations: item.qualificationType.translations,
      positionCode: positionByPilot.get(item.pilotId)?.code,
      positionName: positionByPilot.get(item.pilotId)?.name,
      readonly: true,
    })),
    ...stages.map((item: any) => ({
      id: `stage:${item.id}`,
      type: "upgrade_stage" as const,
      date: dateOnly(item.plannedStart),
      endDate: dateOnly(item.plannedEnd),
      title: upgradeStageLabel(item.code, "zh-CN", item.order),
      pilotId: item.plan.pilotId,
      pilotName: item.plan.pilot.displayName,
      employeeNumber: item.plan.pilot.employeeNumber,
      unit: item.plan.pilot.unit.name,
      positionCode: item.plan.positionCodeSnapshot ?? undefined,
      positionName: item.plan.positionNameSnapshot ?? undefined,
      planId: item.planId,
      planNumber: item.plan.planNumber,
      planTitle: item.plan.title,
      planLifecycleStatus: String(item.plan.lifecycleStatus).toLowerCase() as any,
      stageId: item.id,
      stageCode: item.code,
      stageName: upgradeStageLabel(item.code, "zh-CN", item.order),
      stageStatus: String(item.status).toLowerCase() as any,
      owner: item.owner,
      notes: item.notes,
      inspectionItems: item.inspectionItems.map((inspection: any) => inspection.nameSnapshot),
      readonly: ["COMPLETED", "CANCELLED"].includes(item.plan.lifecycleStatus),
    })),
  ];
  const q = query.q?.trim().toLowerCase();
  return events
    .filter(
      (event) =>
        (!query.type || query.type === "all" || event.type === query.type) &&
        (!query.qualification ||
          query.qualification === "all" ||
          event.qualificationId === query.qualification) &&
        (!positionCodes.length ||
          (event.positionCode && positionCodes.includes(event.positionCode))) &&
        (!q ||
          `${event.pilotName} ${event.employeeNumber} ${event.title}`.toLowerCase().includes(q)),
    )
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.pilotName.localeCompare(b.pilotName, "zh-CN"),
    );
}

export async function getAdminCalendarDayQualificationRoster(
  admin: AuthenticatedAdmin,
  query: CalendarDayQualificationQuery,
): Promise<CalendarDayQualificationRoster> {
  const events = await listAdminCalendarEvents(admin, {
    ...query,
    from: query.date,
    to: query.date,
  });
  const pilotIds = [...new Set(events.map((event) => event.pilotId))];
  if (!pilotIds.length) return { date: query.date, eventCount: 0, pilots: [] };

  const db = getPrisma();
  const [qualificationTypes, records] = await Promise.all([
    db.qualificationType.findMany({
      where: { core: true, code: { in: [...CORE_QUALIFICATION_IDS] } },
    }),
    db.qualificationRecord.findMany({
      where: { pilotId: { in: pilotIds }, status: "ACTIVE" },
      include: { qualificationType: true },
    }),
  ]);
  const order = new Map<string, number>(CORE_QUALIFICATION_IDS.map((id, index) => [id, index]));
  const types = qualificationTypes.sort(
    (a, b) => (order.get(a.code) ?? 999) - (order.get(b.code) ?? 999),
  );
  const clock = selectedDateClock(query.date);
  const people = new Map(
    events.map((event) => [
      event.pilotId,
      {
        pilotId: event.pilotId,
        pilotName: event.pilotName,
        employeeNumber: event.employeeNumber,
        unit: event.unit,
      },
    ]),
  );

  return {
    date: query.date,
    eventCount: events.length,
    pilots: [...people.values()]
      .sort((a, b) => a.pilotName.localeCompare(b.pilotName, "zh-CN"))
      .map((person) => ({
        ...person,
        nodes: events.filter((event) => event.pilotId === person.pilotId),
        qualifications: types.map((type) => {
          const record = records.find(
            (item) => item.pilotId === person.pilotId && item.qualificationTypeId === type.id,
          );
          return {
            qualificationId: type.code,
            qualificationName: type.name,
            qualificationTranslations:
              type.translations && typeof type.translations === "object"
                ? (type.translations as Record<string, string>)
                : {},
            validityRule: type.validityRule as ValidityRule,
            record: record
              ? {
                  ...deriveQualificationDateState(dateOnly(record.expiryDate), clock),
                  recordId: record.id,
                  qualificationId: type.code,
                  qualificationName: type.name,
                  qualificationTranslations:
                    type.translations && typeof type.translations === "object"
                      ? (type.translations as Record<string, string>)
                      : {},
                  credentialNumber: record.credentialNumber,
                  issueDate: dateOnly(record.issueDate),
                  expiryDate: dateOnly(record.expiryDate),
                  issuingAuthority: record.issuingAuthority,
                  levelOrParameter: record.levelOrParameter,
                  lastVerifiedOn: dateOnly(record.lastVerifiedAt),
                  version: record.version,
                }
              : null,
          };
        }),
      })),
  };
}
