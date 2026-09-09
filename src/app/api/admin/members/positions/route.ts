import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";
import { fixedClock } from "@/lib/qualification-date-status";
import { dateOnlyForTimezone, databaseDateOnly } from "@/lib/date-only";
import { memberScopeWhere } from "@/server/member-repository";
import {
  qualificationPersonInclude,
  resolveMemberQualifications,
} from "@/server/member-qualifications";

const DUE_WINDOW_DAYS = 90;

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const clock = fixedClock();
    const admin = await getAdmin(request, "pilots.read");
    const personWhere = memberScopeWhere(admin);
    const positions = await getPrisma().position.findMany({
      where: {
        active: true,
        ...(admin.organizationId ? { organizationId: admin.organizationId } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        assignments: {
          where: { status: "ACTIVE", person: personWhere },
          include: { person: { include: qualificationPersonInclude } },
        },
        requirements: {
          where: { active: true, required: true, qualificationDefinition: { active: true } },
          select: { qualificationDefinitionId: true },
        },
      },
    });
    const result = positions.map((position) => {
      let missing = 0;
      let incomplete = 0;
      let expired = 0;
      let due = 0;
      const timezones = new Set<string>();
      const members = new Map<string, ReturnType<typeof resolveMemberQualifications>>();
      for (const assignment of position.assignments) {
        const resolved = resolveMemberQualifications(assignment.person, clock);
        if (resolved.timezone) {
          const today = dateOnlyForTimezone(clock.now(), resolved.timezone);
          const from = databaseDateOnly(assignment.effectiveFrom);
          const to = databaseDateOnly(assignment.effectiveTo);
          if ((from && from > today) || (to && to < today)) continue;
          timezones.add(resolved.timezone);
        }
        members.set(assignment.personId, resolved);
      }
      for (const member of members.values()) {
        for (const requirement of position.requirements) {
          const item = member.items.find(
            (entry) => entry.definition.id === requirement.qualificationDefinitionId,
          );
          const status = item?.status ?? "missing";
          if (status === "missing") missing += 1;
          else if (status === "incomplete") incomplete += 1;
          else if (status === "expired") expired += 1;
          else if (status === "due") due += 1;
        }
      }
      return {
        id: position.id,
        organizationId: position.organizationId,
        code: position.code,
        name: position.name,
        description: position.description,
        active: position.active,
        sortOrder: position.sortOrder,
        memberCount: members.size,
        requiredQualificationCount: position.requirements.length,
        missingCount: missing,
        incompleteCount: incomplete,
        expiredCount: expired,
        dueCount: due,
        timezones: [...timezones],
        evaluatedAt: clock.now().toISOString(),
        sourcePackCode: position.sourcePackCode,
        sourcePackVersion: position.sourcePackVersion,
      };
    });
    return jsonData({ items: result, dueWindowDays: DUE_WINDOW_DAYS }, requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
