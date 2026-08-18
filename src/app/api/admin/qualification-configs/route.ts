import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  ApiError,
  assertSameOrigin,
  getRequestId,
  jsonData,
  jsonError,
  parseJson,
} from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";
import {
  qualificationConfigCreateSchema,
  qualificationConfigInputSchema,
} from "@/lib/admin-operations-validation";
import {
  customFieldsFromFieldSchema,
  fieldSchemaWithCustomFields,
} from "@/lib/qualification-fields";
import type { AuthenticatedAdmin } from "@/server/auth";
/* eslint-disable @typescript-eslint/no-explicit-any */

const positionCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_-]{0,63}$/);

const patchSchema = z.intersection(
  qualificationConfigInputSchema,
  z.object({ expectedVersion: z.number().int().positive().optional() }),
);

const createSchema = z.intersection(
  qualificationConfigCreateSchema,
  z.object({
    positionCode: positionCodeSchema,
    kind: z.enum(["core", "supplemental"]),
  }),
);

function organizationId(admin: AuthenticatedAdmin) {
  return admin.organizationId ?? admin.unitId;
}

async function resolvePosition(admin: AuthenticatedAdmin, code: string) {
  const scopedOrganizationId = organizationId(admin);
  const positions = await getPrisma().position.findMany({
    where: {
      code,
      ...(scopedOrganizationId ? { organizationId: scopedOrganizationId } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  if (!positions.length) throw new ApiError("POSITION_NOT_FOUND", "职位不存在", 404);
  if (positions.length > 1) {
    throw new ApiError("POSITION_AMBIGUOUS", "该职位存在于多个组织，请先选择数据范围", 409);
  }
  return positions[0]!;
}

function serializeRequirement(requirement: any) {
  const definition = requirement.qualificationDefinition;
  return {
    id: requirement.id,
    qualificationId: definition.id,
    positionCode: requirement.position.code,
    code: definition.code,
    name: definition.name,
    core: requirement.required && requirement.upgradePrerequisite,
    locked: Boolean(requirement.sourcePackCode),
    active: requirement.active && definition.active,
    customFields: customFieldsFromFieldSchema(definition.fieldSchema),
    parameterRestriction: definition.parameterRestriction,
    validityRule: definition.validityRule,
    reminders: definition.reminders,
    ocrChecks: definition.ocrChecks,
    createdAt: requirement.createdAt.toISOString(),
    updatedAt: requirement.updatedAt.toISOString(),
    version: requirement.version,
  };
}

async function findRequirement(positionId: string, id: string) {
  const requirement = await getPrisma().qualificationRequirement.findFirst({
    where: { id, positionId },
    include: { position: true, qualificationDefinition: true },
  });
  if (!requirement) throw new ApiError("NOT_FOUND", "资质配置不存在", 404);
  return requirement;
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "operations.read");
    const positionCode = positionCodeSchema.parse(
      new URL(request.url).searchParams.get("positionCode"),
    );
    const position = await resolvePosition(admin, positionCode);
    const requirements = await getPrisma().qualificationRequirement.findMany({
      where: { positionId: position.id },
      include: { position: true, qualificationDefinition: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return jsonData(requirements.map(serializeRequirement), requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "operations.write", true);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) throw new ApiError("VALIDATION_ERROR", "缺少资质配置 ID", 422);
    const positionCode = positionCodeSchema.parse(url.searchParams.get("positionCode"));
    const input = await parseJson(request, patchSchema);
    const position = await resolvePosition(admin, positionCode);
    const current = await findRequirement(position.id, id);
    const definition = current.qualificationDefinition;
    const locked = Boolean(current.sourcePackCode);
    if (locked && input.name !== definition.name) {
      throw new ApiError("LOCKED_QUALIFICATION", "模板核心资质不可改名", 422);
    }
    if (locked && !input.active) {
      throw new ApiError("LOCKED_QUALIFICATION", "模板核心资质不可停用", 422);
    }
    const duplicateName = await getPrisma().qualificationRequirement.findFirst({
      where: {
        positionId: position.id,
        id: { not: current.id },
        qualificationDefinition: {
          name: { equals: input.name, mode: "insensitive" },
        },
      },
      select: { id: true },
    });
    if (duplicateName) {
      throw new ApiError("DUPLICATE_QUALIFICATION", "当前职位已存在同名资质", 409);
    }

    const updated = await getPrisma().$transaction(async (tx) => {
      const requirementUpdate = await tx.qualificationRequirement.updateMany({
        where: {
          id: current.id,
          ...(input.expectedVersion ? { version: input.expectedVersion } : {}),
        },
        data: { active: input.active, version: { increment: 1 }, customizedAt: new Date() },
      });
      if (requirementUpdate.count !== 1) {
        throw new ApiError("VERSION_CONFLICT", "资质配置已被其他管理员修改", 409);
      }
      await tx.qualificationDefinition.update({
        where: { id: definition.id },
        data: {
          name: locked ? definition.name : input.name,
          active: input.active,
          fieldSchema: fieldSchemaWithCustomFields(
            definition.fieldSchema,
            input.customFields,
          ) as any,
          parameterRestriction: input.parameterRestriction as any,
          validityRule: input.validityRule as any,
          reminders: input.reminders as any,
          ocrChecks: input.ocrChecks as any,
          customizedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (input.active) {
        const assignments = await tx.personPositionAssignment.findMany({
          where: { positionId: position.id, status: "ACTIVE" },
          select: { id: true, personId: true },
        });
        for (const assignment of assignments) {
          await tx.qualificationAssignment.upsert({
            where: {
              positionAssignmentId_requirementId: {
                positionAssignmentId: assignment.id,
                requirementId: current.id,
              },
            },
            update: { active: true, endedAt: null, version: { increment: 1 } },
            create: {
              personId: assignment.personId,
              qualificationDefinitionId: definition.id,
              requirementId: current.id,
              positionAssignmentId: assignment.id,
              source: "POSITION_REQUIREMENT",
            },
          });
        }
      } else {
        await tx.qualificationAssignment.updateMany({
          where: { requirementId: current.id, active: true },
          data: { active: false, endedAt: new Date(), version: { increment: 1 } },
        });
      }
      return tx.qualificationRequirement.findUniqueOrThrow({
        where: { id: current.id },
        include: { position: true, qualificationDefinition: true },
      });
    });
    await getPrisma().auditEvent.create({
      data: {
        actorType: "admin",
        actorId: admin.id,
        action: "position_qualification.updated",
        entityType: "QualificationRequirement",
        entityId: current.id,
        detail: { positionCode, active: input.active } as any,
        requestId,
      },
    });
    return jsonData(serializeRequirement(updated), requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "operations.write", true);
    const input = await parseJson(request, createSchema);
    const position = await resolvePosition(admin, input.positionCode);
    const duplicateName = await getPrisma().qualificationRequirement.findFirst({
      where: {
        positionId: position.id,
        qualificationDefinition: {
          name: { equals: input.name, mode: "insensitive" },
        },
      },
      select: { id: true },
    });
    if (duplicateName) {
      throw new ApiError("DUPLICATE_QUALIFICATION", "当前职位已存在同名资质", 409);
    }
    const prefix = position.code.toLowerCase().replaceAll("_", "-").slice(0, 48);
    const code = input.code ?? `${prefix}-custom-${randomUUID().slice(0, 8)}`;
    const existingCode = await getPrisma().qualificationDefinition.findUnique({
      where: {
        organizationId_code: { organizationId: position.organizationId, code },
      },
      select: { id: true },
    });
    if (existingCode) {
      throw new ApiError("DUPLICATE_QUALIFICATION", "资质编码已存在", 409);
    }

    const created = await getPrisma().$transaction(async (tx) => {
      const lastRequirement = await tx.qualificationRequirement.findFirst({
        where: { positionId: position.id },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      const definition = await tx.qualificationDefinition.create({
        data: {
          organizationId: position.organizationId,
          code,
          name: input.name,
          description: "",
          translations: {},
          category: "aviation",
          active: input.active,
          requiresEvidence: true,
          requiresHumanReview: true,
          allowAutoApproval: false,
          fieldSchema: { fields: [], customFields: input.customFields },
          validityRule: input.validityRule as any,
          reminders: input.reminders as any,
          ocrChecks: input.ocrChecks as any,
          parameterRestriction: input.parameterRestriction as any,
          sortOrder: (lastRequirement?.sortOrder ?? -1) + 1,
          customizedAt: new Date(),
        },
      });
      const core = input.kind === "core";
      const requirement = await tx.qualificationRequirement.create({
        data: {
          positionId: position.id,
          qualificationDefinitionId: definition.id,
          required: core,
          upgradePrerequisite: core,
          active: input.active,
          sortOrder: (lastRequirement?.sortOrder ?? -1) + 1,
          customizedAt: new Date(),
        },
        include: { position: true, qualificationDefinition: true },
      });
      if (input.active) {
        const assignments = await tx.personPositionAssignment.findMany({
          where: { positionId: position.id, status: "ACTIVE" },
          select: { id: true, personId: true },
        });
        for (const assignment of assignments) {
          await tx.qualificationAssignment.create({
            data: {
              personId: assignment.personId,
              qualificationDefinitionId: definition.id,
              requirementId: requirement.id,
              positionAssignmentId: assignment.id,
              source: "POSITION_REQUIREMENT",
            },
          });
        }
      }
      return requirement;
    });
    await getPrisma().auditEvent.create({
      data: {
        actorType: "admin",
        actorId: admin.id,
        action: "position_qualification.created",
        entityType: "QualificationRequirement",
        entityId: created.id,
        detail: { positionCode: input.positionCode, kind: input.kind } as any,
        requestId,
      },
    });
    return jsonData(serializeRequirement(created), requestId, 201);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
