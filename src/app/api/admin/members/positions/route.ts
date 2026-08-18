import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";

const DUE_WINDOW_DAYS = 90;

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "pilots.read");
    const organizationId = admin.organizationId ?? admin.unitId;
    const db = getPrisma();
    const positions = await db.position.findMany({
      where: { active: true, ...(organizationId ? { organizationId } : {}) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        assignments: {
          where: { status: "ACTIVE", ...(organizationId ? { person: { organizationId } } : {}) },
          select: { personId: true },
        },
        requirements: {
          where: { active: true, required: true },
          select: { qualificationDefinitionId: true },
        },
      },
    });
    const personIds = [
      ...new Set(
        positions.flatMap((position) => position.assignments.map((item) => item.personId)),
      ),
    ];
    const definitionIds = [
      ...new Set(
        positions.flatMap((position) =>
          position.requirements.map((item) => item.qualificationDefinitionId),
        ),
      ),
    ];
    const records =
      personIds.length && definitionIds.length
        ? await db.qualificationRecord.findMany({
            where: {
              personId: { in: personIds },
              qualificationDefinitionId: { in: definitionIds },
              status: "ACTIVE",
            },
            select: { personId: true, qualificationDefinitionId: true, expiryDate: true },
          })
        : [];
    const recordByKey = new Map(
      records.map((record) => [`${record.personId}:${record.qualificationDefinitionId}`, record]),
    );
    const dueAt = new Date(Date.now() + DUE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const result = positions.map((position) => {
      const required = position.requirements;
      let missing = 0;
      let expired = 0;
      let due = 0;
      for (const assignment of position.assignments) {
        for (const requirement of required) {
          const record = recordByKey.get(
            `${assignment.personId}:${requirement.qualificationDefinitionId}`,
          );
          if (!record) {
            missing += 1;
          } else if (record.expiryDate && record.expiryDate < new Date()) {
            expired += 1;
          } else if (record.expiryDate && record.expiryDate <= dueAt) {
            due += 1;
          }
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
        memberCount: position.assignments.length,
        requiredQualificationCount: required.length,
        missingCount: missing,
        expiredCount: expired,
        dueCount: due,
        sourcePackCode: position.sourcePackCode,
        sourcePackVersion: position.sourcePackVersion,
      };
    });
    return jsonData({ items: result, dueWindowDays: DUE_WINDOW_DAYS }, requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
