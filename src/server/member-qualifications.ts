import type { Prisma } from "@/generated/prisma/client";
import type { Clock, QualificationDateState } from "@/types/services";
import { databaseDateOnly, dateOnlyForTimezone } from "@/lib/date-only";
import {
  evaluateStoredQualification,
  fixedClock,
  systemClock,
} from "@/lib/qualification-date-status";
import { memberQualificationTimezone } from "@/lib/qualification-timezone";
import { memberQualificationStatus, summarizeMemberQualifications } from "@/lib/member-health";
import { observeCompatibilityPath } from "@/server/compatibility-observability";

export const qualificationUnitSelect = {
  id: true,
  timezone: true,
  organizationId: true,
} as const satisfies Prisma.OrganizationUnitSelect;

export const qualificationPersonInclude = {
  unit: { select: qualificationUnitSelect },
  qualificationAssignments: {
    where: { active: true },
    include: {
      qualificationDefinition: true,
      requirement: { include: { position: true } },
      positionAssignment: { include: { position: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  qualificationRecords: {
    where: { status: "ACTIVE" },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  },
  legacyPilot: {
    include: {
      unit: { select: qualificationUnitSelect },
      qualifications: {
        where: { status: "ACTIVE" },
        include: { qualificationType: true },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      },
    },
  },
} as const satisfies Prisma.PersonInclude;

export type QualificationPerson = Prisma.PersonGetPayload<{
  include: typeof qualificationPersonInclude;
}>;
export type IncludedQualificationAssignment =
  QualificationPerson["qualificationAssignments"][number];
type StoredRecord = QualificationPerson["qualificationRecords"][number];

export function qualificationAssignmentIsEffective(
  assignment: IncludedQualificationAssignment,
  timezone: string | null,
  clock: Clock,
) {
  if (!assignment.active || !assignment.qualificationDefinition.active) return false;
  if (
    assignment.requirement &&
    (!assignment.requirement.active || !assignment.requirement.position.active)
  )
    return false;
  const position = assignment.positionAssignment;
  if (!position) return true;
  if (position.status !== "ACTIVE" || position.position?.active === false) return false;
  // Keep requirements visible when a unit is misconfigured, so their data issue is not green.
  if (!timezone) return true;
  const today = dateOnlyForTimezone(clock.now(), timezone);
  const from = databaseDateOnly(position.effectiveFrom);
  const to = databaseDateOnly(position.effectiveTo);
  return (!from || from <= today) && (!to || to >= today);
}

function duplicateRecordState(): QualificationDateState {
  return {
    status: "incomplete",
    window: "incomplete",
    daysRemaining: null,
    statusLabel: "数据不完整",
    remainingLabel: "请联系管理员核查",
    statusReason: "duplicate_active_records",
  };
}

export function resolveMemberQualifications(
  person: QualificationPerson,
  clock: Clock = systemClock,
  options: { observeCompatibility?: boolean } = {},
) {
  const capturedClock = fixedClock(clock);
  const timezone = memberQualificationTimezone(person);
  const groups = new Map<string, IncludedQualificationAssignment[]>();
  for (const assignment of person.qualificationAssignments) {
    if (!qualificationAssignmentIsEffective(assignment, timezone, capturedClock)) continue;
    const existing = groups.get(assignment.qualificationDefinitionId) ?? [];
    existing.push(assignment);
    groups.set(assignment.qualificationDefinitionId, existing);
  }
  const items = [...groups.values()].map((assignments) => {
    const first = assignments[0]!;
    const definition = first.qualificationDefinition;
    const canonical = person.qualificationRecords.filter(
      (record) => record.qualificationDefinitionId === definition.id,
    );
    const legacy = (person.legacyPilot?.qualifications ?? []).filter(
      (record) =>
        (!record.personId || record.personId === person.id) &&
        (!record.qualificationDefinitionId || record.qualificationDefinitionId === definition.id) &&
        (record.qualificationTypeId === definition.legacyQualificationTypeId ||
          record.qualificationType.code === definition.code),
    );
    const candidates: StoredRecord[] = canonical.length ? canonical : legacy;
    const record = candidates[0] ?? null;
    if (record && !canonical.length && options.observeCompatibility !== false)
      observeCompatibilityPath("legacy_record_fallback");
    const state =
      candidates.length > 1
        ? duplicateRecordState()
        : evaluateStoredQualification(record, capturedClock, timezone);
    return {
      definition,
      assignments,
      required: assignments.some((assignment) => assignment.requirement?.required ?? true),
      upgradePrerequisite: assignments.some(
        (assignment) => assignment.requirement?.upgradePrerequisite ?? false,
      ),
      record,
      recordSource: record
        ? canonical.length
          ? ("canonical" as const)
          : ("legacy" as const)
        : null,
      state,
      status: memberQualificationStatus(state.status),
    };
  });
  return {
    items,
    timezone,
    evaluatedAt: capturedClock.now().toISOString(),
    ...summarizeMemberQualifications(items),
  };
}

export function qualificationAssignmentSource(assignment: IncludedQualificationAssignment) {
  return {
    assignmentId: assignment.id,
    requirementId: assignment.requirementId,
    positionAssignmentId: assignment.positionAssignmentId,
    positionCode:
      assignment.positionAssignment?.position?.code ??
      assignment.positionAssignment?.positionCodeSnapshot ??
      assignment.requirement?.position.code ??
      null,
    positionName:
      assignment.positionAssignment?.position?.name ??
      assignment.positionAssignment?.positionNameSnapshot ??
      assignment.requirement?.position.name ??
      "已删除职位",
    source: assignment.source,
    required: assignment.requirement?.required ?? true,
  };
}
