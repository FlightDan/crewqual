import { ApiError } from "@/server/api";
import { requireAssignedUnit } from "@/server/admin-permissions";
import type { AuthenticatedAdmin } from "@/server/auth";
import { getPrisma } from "@/server/prisma";
/* eslint-disable @typescript-eslint/no-explicit-any */

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

function statusFor(expiryDate: Date | null) {
  if (!expiryDate) return "valid" as const;
  const now = Date.now();
  const expiry = expiryDate.getTime();
  if (expiry < now) return "expired" as const;
  if (expiry <= now + DUE_WINDOW_DAYS * 24 * 60 * 60 * 1000) return "due" as const;
  return "valid" as const;
}

function organizationWhere(admin: AuthenticatedAdmin) {
  const organizationId = admin.organizationId ?? requireAssignedUnit(admin);
  return organizationId ? { organizationId } : {};
}

const memberInclude = {
  pilotProfile: true,
  positionAssignments: {
    where: { status: "ACTIVE" as const },
    include: { position: true },
    orderBy: { isPrimary: "desc" as const },
  },
  qualificationAssignments: {
    where: { active: true },
    include: {
      qualificationDefinition: true,
      requirement: { include: { position: true } },
      positionAssignment: { include: { position: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
  qualificationRecords: {
    where: { status: "ACTIVE" as const },
    orderBy: { updatedAt: "desc" as const },
  },
  legacyPilot: {
    include: {
      qualifications: {
        where: { status: "ACTIVE" as const },
        include: { qualificationType: true },
        orderBy: { updatedAt: "desc" as const },
      },
    },
  },
} as const;

type IncludedMember = Awaited<ReturnType<typeof getPrisma>>["person"] extends never ? never : any;

function serializeMember(person: IncludedMember) {
  const records = new Map<string, any>();
  for (const record of person.qualificationRecords ?? []) {
    if (record.qualificationDefinitionId && !records.has(record.qualificationDefinitionId)) {
      records.set(record.qualificationDefinitionId, record);
    }
  }
  const legacyRecords = person.legacyPilot?.qualifications ?? [];
  const assignments = person.qualificationAssignments ?? [];
  for (const assignment of assignments) {
    if (records.has(assignment.qualificationDefinitionId)) continue;
    const legacy = legacyRecords.find(
      (record: any) =>
        record.qualificationTypeId ===
          assignment.qualificationDefinition.legacyQualificationTypeId ||
        record.qualificationType.code === assignment.qualificationDefinition.code,
    );
    if (legacy) records.set(assignment.qualificationDefinitionId, legacy);
  }
  const seen = new Set<string>();
  const qualifications = assignments
    .filter((assignment: any) => {
      if (seen.has(assignment.qualificationDefinitionId)) return false;
      seen.add(assignment.qualificationDefinitionId);
      return true;
    })
    .map((assignment: any) => {
      const record = records.get(assignment.qualificationDefinitionId);
      return {
        assignmentId: assignment.id,
        requirementId: assignment.requirementId,
        definitionId: assignment.qualificationDefinitionId,
        code: assignment.qualificationDefinition.code,
        name: assignment.qualificationDefinition.name,
        description: assignment.qualificationDefinition.description,
        positionCode:
          assignment.positionAssignment?.position.code ??
          assignment.requirement?.position.code ??
          null,
        positionName:
          assignment.positionAssignment?.position.name ??
          assignment.requirement?.position.name ??
          null,
        source: assignment.source,
        required: assignment.requirement?.required ?? true,
        upgradePrerequisite: assignment.requirement?.upgradePrerequisite ?? false,
        status: statusFor(record?.expiryDate ?? null),
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
  const counts = qualifications.reduce(
    (result: { missing: number; expired: number; due: number; valid: number }, item: any) => {
      const key = item.status as keyof typeof result;
      result[key] += 1;
      return result;
    },
    { missing: 0, expired: 0, due: 0, valid: 0 },
  );
  const primary =
    person.positionAssignments?.find((assignment: any) => assignment.isPrimary) ??
    person.positionAssignments?.[0];
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
    primaryPosition: primary
      ? { code: primary.position.code, name: primary.position.name, assignmentId: primary.id }
      : null,
    positions: (person.positionAssignments ?? []).map((assignment: any) => ({
      code: assignment.position.code,
      name: assignment.position.name,
      assignmentId: assignment.id,
      isPrimary: assignment.isPrimary,
      effectiveFrom: dateOnly(assignment.effectiveFrom),
      effectiveTo: dateOnly(assignment.effectiveTo),
    })),
    pilotProfile: person.pilotProfile
      ? {
          aircraftType: person.pilotProfile.aircraftType,
          dutyLabel: person.pilotProfile.dutyLabel,
          rankLabel: person.pilotProfile.rankLabel,
        }
      : null,
    qualifications,
    health:
      counts.missing > 0
        ? "missing"
        : counts.expired > 0
          ? "expired"
          : counts.due > 0
            ? "due"
            : "valid",
    qualificationCounts: counts,
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
) {
  const db = getPrisma();
  const codes = positionCodes(query.positions);
  const search = query.q?.trim();
  const where = {
    ...organizationWhere(admin),
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
    items: people.map(serializeMember),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    dueWindowDays: DUE_WINDOW_DAYS,
  };
}

export async function getMember(admin: AuthenticatedAdmin, memberId: string) {
  const db = getPrisma();
  const person = await db.person.findFirst({
    where: { id: memberId, ...organizationWhere(admin) },
    include: memberInclude,
  });
  if (!person) throw new ApiError("NOT_FOUND", "成员不存在或不属于当前组织", 404);
  return serializeMember(person);
}
