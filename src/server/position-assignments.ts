import { ApiError } from "@/server/api";
import { requireAssignedUnit } from "@/server/admin-permissions";
import type { AuthenticatedAdmin } from "@/server/auth";
import { getPrisma } from "@/server/prisma";
import {
  lockPositionAssignment,
  UPGRADE_PLAN_STATUSES_BLOCKING_ASSIGNMENT_END,
} from "@/server/upgrade-plan-rules";

function scope(admin: AuthenticatedAdmin) {
  const organizationId = admin.organizationId ?? requireAssignedUnit(admin);
  return organizationId ? { organizationId } : {};
}

export async function assignPosition(
  admin: AuthenticatedAdmin,
  personId: string,
  input: { positionCode: string; isPrimary?: boolean; effectiveFrom?: string },
) {
  const db = getPrisma();
  const person = await db.person.findFirst({ where: { id: personId, ...scope(admin) } });
  if (!person) throw new ApiError("NOT_FOUND", "成员不存在或不属于当前组织", 404);
  const position = await db.position.findFirst({
    where: {
      organizationId: person.organizationId,
      code: input.positionCode.toUpperCase(),
      active: true,
    },
  });
  if (!position) throw new ApiError("POSITION_NOT_FOUND", "职位不存在或已停用", 404);
  const effectiveFrom = input.effectiveFrom
    ? new Date(`${input.effectiveFrom}T00:00:00.000Z`)
    : new Date();
  return db.$transaction(async (tx) => {
    if (input.isPrimary !== false) {
      await tx.personPositionAssignment.updateMany({
        where: { personId, status: "ACTIVE", isPrimary: true },
        data: { isPrimary: false },
      });
    }
    const assignment = await tx.personPositionAssignment.create({
      data: {
        personId,
        positionId: position.id,
        positionCodeSnapshot: position.code,
        positionNameSnapshot: position.name,
        isPrimary: input.isPrimary !== false,
        effectiveFrom,
      },
      include: { position: true },
    });
    const requirements = await tx.qualificationRequirement.findMany({
      where: { positionId: position.id, active: true },
      select: { id: true, qualificationDefinitionId: true },
    });
    for (const requirement of requirements) {
      await tx.qualificationAssignment.upsert({
        where: {
          positionAssignmentId_requirementId: {
            positionAssignmentId: assignment.id,
            requirementId: requirement.id,
          },
        },
        update: { active: true, endedAt: null },
        create: {
          personId,
          qualificationDefinitionId: requirement.qualificationDefinitionId,
          requirementId: requirement.id,
          positionAssignmentId: assignment.id,
          source: "POSITION_REQUIREMENT",
        },
      });
    }
    return assignment;
  });
}

export async function endPositionAssignment(
  admin: AuthenticatedAdmin,
  personId: string,
  assignmentId: string,
  effectiveTo?: string,
) {
  const db = getPrisma();
  return db.$transaction(async (tx) => {
    // Resolve tenant visibility before taking a row lock so an administrator
    // cannot use an out-of-scope UUID to contend on another organization's
    // assignment. Re-read after the lock to preserve race safety.
    const visibleAssignment = await tx.personPositionAssignment.findFirst({
      where: { id: assignmentId, personId, person: scope(admin), status: "ACTIVE" },
      select: { id: true },
    });
    if (!visibleAssignment) throw new ApiError("NOT_FOUND", "任职记录不存在或已结束", 404);
    // The start route takes this same lock before re-checking eligibility.
    // Keeping the plan check inside the locked transaction closes the race
    // between ending an assignment and starting its linked plan.
    await lockPositionAssignment(tx, assignmentId);
    const assignment = await tx.personPositionAssignment.findFirst({
      where: { id: assignmentId, personId, person: scope(admin), status: "ACTIVE" },
      include: { position: true },
    });
    if (!assignment) throw new ApiError("NOT_FOUND", "任职记录不存在或已结束", 404);
    const blockingPlan = await tx.upgradePlan.findFirst({
      where: {
        positionAssignmentId: assignmentId,
        lifecycleStatus: { in: UPGRADE_PLAN_STATUSES_BLOCKING_ASSIGNMENT_END },
      },
      select: { planNumber: true },
    });
    if (blockingPlan) {
      throw new ApiError(
        "ACTIVE_UPGRADE_PLAN",
        `职位仍有未完成的升级计划：${blockingPlan.planNumber}`,
        409,
      );
    }
    const endedAt = effectiveTo ? new Date(`${effectiveTo}T00:00:00.000Z`) : new Date();
    const result = await tx.personPositionAssignment.update({
      where: { id: assignmentId },
      data: { status: "ENDED", isPrimary: false, effectiveTo: endedAt, version: { increment: 1 } },
      include: { position: true },
    });
    await tx.qualificationAssignment.updateMany({
      where: { positionAssignmentId: assignmentId, active: true },
      data: { active: false, endedAt: new Date() },
    });
    return result;
  });
}
