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
import {
  ocrChecksSchema,
  parameterRestrictionSchema,
  reminderRuleSchema,
  validityRuleSchema,
} from "@/lib/qualification-rules";
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
    translations: definition.translations ?? {},
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

function normalizedStructure(value: {
  fieldSchema: unknown;
  parameterRestriction: unknown;
  validityRule: unknown;
  reminders: unknown;
  ocrChecks: unknown;
}) {
  return {
    customFields: customFieldsFromFieldSchema(value.fieldSchema),
    parameterRestriction: parameterRestrictionSchema.parse(value.parameterRestriction),
    validityRule: validityRuleSchema.parse(value.validityRule),
    reminders: reminderRuleSchema.parse(value.reminders),
    ocrChecks: ocrChecksSchema.parse(value.ocrChecks),
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
    if (locked && !input.active) {
      throw new ApiError("LOCKED_QUALIFICATION", "模板核心资质不可停用", 422);
    }
    if (
      locked &&
      JSON.stringify(normalizedStructure(definition)) !==
        JSON.stringify({
          customFields: input.customFields,
          parameterRestriction: input.parameterRestriction,
          validityRule: input.validityRule,
          reminders: input.reminders,
          ocrChecks: input.ocrChecks,
        })
    ) {
      throw new ApiError("LOCKED_QUALIFICATION", "模板核心资质的结构化规则不可修改", 422);
    }
    const duplicateRequirements =
      (await getPrisma().qualificationRequirement.findMany({
        where: {
          positionId: position.id,
          id: { not: current.id },
        },
        select: { qualificationDefinition: { select: { name: true, translations: true } } },
      })) ?? [];
    const localizedName =
      input.locale === "zh-CN"
        ? input.name
        : (input.translations?.[input.locale] ?? definition.name);
    const duplicateName = duplicateRequirements.some((item: any) => {
      const translations = item.qualificationDefinition.translations;
      const candidate =
        translations && typeof translations === "object" && !Array.isArray(translations)
          ? (translations as Record<string, unknown>)[input.locale]
          : undefined;
      const value =
        typeof candidate === "string" && candidate.trim()
          ? candidate
          : item.qualificationDefinition.name;
      return value.trim().toLocaleLowerCase() === localizedName.trim().toLocaleLowerCase();
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
      const translations = {
        ...(definition.translations && typeof definition.translations === "object"
          ? (definition.translations as Record<string, string>)
          : {}),
        ...(input.translations ?? {}),
      };
      if (input.locale === "zh-CN") translations[input.locale] = input.name;
      await tx.qualificationDefinition.update({
        where: { id: definition.id },
        data: {
          name: input.locale === "zh-CN" ? input.name : definition.name,
          translations: translations as any,
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
    const duplicateRequirements =
      (await getPrisma().qualificationRequirement.findMany({
        where: {
          positionId: position.id,
        },
        select: { qualificationDefinition: { select: { name: true, translations: true } } },
      })) ?? [];
    const localizedName = input.translations?.[input.locale] ?? input.name;
    const duplicateName = duplicateRequirements.some((item: any) => {
      const translations = item.qualificationDefinition.translations;
      const candidate =
        translations && typeof translations === "object" && !Array.isArray(translations)
          ? (translations as Record<string, unknown>)[input.locale]
          : undefined;
      const value =
        typeof candidate === "string" && candidate.trim()
          ? candidate
          : item.qualificationDefinition.name;
      return value.trim().toLocaleLowerCase() === localizedName.trim().toLocaleLowerCase();
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
          translations: input.translations ?? { [input.locale]: input.name },
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
