import { ApiError } from "@/server/api";
import { personScopeWhere } from "@/server/admin-permissions";
import type { AuthenticatedAdmin } from "@/server/auth";
import { getPrisma } from "@/server/prisma";
import { pilotRoleLabel } from "@/lib/domain-i18n";
import type { Prisma } from "@/generated/prisma/client";
import type { Clock } from "@/types/services";
import { fixedClock, systemClock } from "@/lib/qualification-date-status";
import {
  qualificationPersonInclude,
  qualificationAssignmentSource,
  resolveMemberQualifications,
} from "@/server/member-qualifications";

const DUE_WINDOW_DAYS = 90;

function dateOnly(value: Date | null | undefined) {
  return value?.toISOString().slice(0, 10) ?? null;
}

function positionCodes(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

export function memberScopeWhere(admin: AuthenticatedAdmin): Prisma.PersonWhereInput {
  return personScopeWhere(admin);
}

const memberInclude = {
  ...qualificationPersonInclude,
  pilotProfile: true,
  positionAssignments: {
    include: { position: true },
    orderBy: { status: "asc" },
  },
} as const satisfies Prisma.PersonInclude;

type IncludedMember = Prisma.PersonGetPayload<{ include: typeof memberInclude }>;

function serializeMember(person: IncludedMember, clock: Clock) {
  const resolved = resolveMemberQualifications(person, clock);
  const qualifications = resolved.items.map((item) => {
    const sources = item.assignments.map(qualificationAssignmentSource);
    const first = sources[0]!;
    const record = item.record;
    return {
      ...first,
      definitionId: item.definition.id,
      code: item.definition.code,
      name: item.definition.name,
      translations: item.definition.translations,
      description: item.definition.description,
      sources,
      required: item.required,
      upgradePrerequisite: item.upgradePrerequisite,
      ...item.state,
      status: item.status,
      recordSource: item.recordSource,
      record: record
        ? {
            id: record.id,
            credentialNumber: record.credentialNumber,
            issueDate: dateOnly(record.issueDate),
            trainingDate: dateOnly(record.trainingDate),
            expiryDate: dateOnly(record.expiryDate),
            issuingAuthority: record.issuingAuthority,
            levelOrParameter: record.levelOrParameter,
            version: record.version,
          }
        : null,
    };
  });
  const primary =
    person.positionAssignments.find(
      (assignment) => assignment.status === "ACTIVE" && assignment.isPrimary,
    ) ??
    person.positionAssignments.find((assignment) => assignment.status === "ACTIVE") ??
    person.positionAssignments.find((assignment) => assignment.isPrimary) ??
    person.positionAssignments[0];
  const positionLabel = (assignment: IncludedMember["positionAssignments"][number]) => ({
    code: assignment.position?.code ?? assignment.positionCodeSnapshot ?? null,
    name: assignment.position?.name ?? assignment.positionNameSnapshot ?? "已删除职位",
  });
  return {
    id: person.id,
    employeeNumber: person.employeeNumber,
    displayName: person.displayName,
    initials: person.initials,
    mobile: person.mobile,
    active: person.active,
    version: person.version,
    organizationId: person.organizationId,
    unitId: person.unitId,
    timezone: resolved.timezone,
    evaluatedAt: resolved.evaluatedAt,
    primaryPosition: primary ? { ...positionLabel(primary), assignmentId: primary.id } : null,
    positions: person.positionAssignments.map((assignment) => ({
      ...positionLabel(assignment),
      assignmentId: assignment.id,
      status: assignment.status,
      isPrimary: assignment.isPrimary,
      effectiveFrom: dateOnly(assignment.effectiveFrom),
      effectiveTo: dateOnly(assignment.effectiveTo),
    })),
    pilotProfile: person.pilotProfile
      ? {
          aircraftType: person.pilotProfile.aircraftType,
          dutyCode: person.pilotProfile.dutyCode,
          dutyLabel: pilotRoleLabel(person.pilotProfile.dutyCode),
          rankLabel: person.pilotProfile.rankLabel,
        }
      : null,
    qualifications,
    health: resolved.health,
    qualificationCounts: resolved.qualificationCounts,
    requiredQualificationCounts: resolved.requiredQualificationCounts,
  };
}

export async function listMembers(
  admin: AuthenticatedAdmin,
  query: {
    q?: string;
    positions?: string;
    status?: "all" | "active" | "inactive";
    page?: number;
    pageSize?: number;
  },
  clock: Clock = systemClock,
) {
  const capturedClock = fixedClock(clock);
  const db = getPrisma();
  const codes = positionCodes(query.positions);
  const search = query.q?.trim();
  const where = {
    ...memberScopeWhere(admin),
    ...(search
      ? {
          OR: [
            { displayName: { contains: search, mode: "insensitive" as const } },
            { employeeNumber: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(query.status && query.status !== "all" ? { active: query.status === "active" } : {}),
    ...(codes.length
      ? {
          positionAssignments: {
            some: { status: "ACTIVE" as const, position: { code: { in: codes } } },
          },
        }
      : {}),
  };
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const [total, people] = await Promise.all([
    db.person.count({ where }),
    db.person.findMany({
      where,
      include: memberInclude,
      orderBy: { displayName: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    items: people.map((person) => serializeMember(person, capturedClock)),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    dueWindowDays: DUE_WINDOW_DAYS,
  };
}

export async function getMember(
  admin: AuthenticatedAdmin,
  memberId: string,
  clock: Clock = systemClock,
) {
  const capturedClock = fixedClock(clock);
  const db = getPrisma();
  const person = await db.person.findFirst({
    where: { id: memberId, ...memberScopeWhere(admin) },
    include: memberInclude,
  });
  if (!person) throw new ApiError("NOT_FOUND", "成员不存在或不属于当前组织", 404);
  return serializeMember(person, capturedClock);
}
