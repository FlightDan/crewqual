import { NextRequest } from "next/server";
import { z } from "zod";
import {
  assertSameOrigin,
  ApiError,
  getRequestId,
  jsonData,
  jsonError,
  parseJson,
} from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";
import {
  adminOrganizationWhere,
  resolveOrganizationTarget,
} from "@/server/admin-organization-scope";
import {
  ocrChecksSchema,
  parameterRestrictionSchema,
  reminderRuleSchema,
  validityRuleSchema,
} from "@/lib/qualification-rules";
/* eslint-disable @typescript-eslint/no-explicit-any */

const definitionSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,127}$/)
    .optional(),
  name: z.string().trim().min(2).max(256),
  description: z.string().trim().max(2000).default(""),
  translations: z.record(z.string(), z.string()).default({}),
  category: z.string().trim().min(1).max(64).default("aviation"),
  active: z.boolean().default(true),
  requiresEvidence: z.boolean().default(true),
  requiresHumanReview: z.boolean().default(true),
  allowAutoApproval: z.boolean().default(false),
  fieldSchema: z.record(z.string(), z.unknown()).default({ fields: [] }),
  validityRule: validityRuleSchema,
  reminders: reminderRuleSchema,
  ocrChecks: ocrChecksSchema,
  parameterRestriction: parameterRestrictionSchema,
  expectedVersion: z.number().int().positive().optional(),
});

function serialize(item: any) {
  return {
    id: item.id,
    organizationId: item.organizationId,
    code: item.code,
    name: item.name,
    description: item.description,
    translations: item.translations,
    category: item.category,
    active: item.active,
    requiresEvidence: item.requiresEvidence,
    requiresHumanReview: item.requiresHumanReview,
    allowAutoApproval: item.allowAutoApproval,
    fieldSchema: item.fieldSchema,
    validityRule: item.validityRule,
    reminders: item.reminders,
    ocrChecks: item.ocrChecks,
    parameterRestriction: item.parameterRestriction,
    sortOrder: item.sortOrder,
    version: item.version,
    sourcePackCode: item.sourcePackCode,
    sourcePackVersion: item.sourcePackVersion,
    customizedAt: item.customizedAt?.toISOString?.() ?? null,
    requirements: (item.requirements ?? []).map((requirement: any) => ({
      id: requirement.id,
      positionCode: requirement.position.code,
      positionName: requirement.position.name,
      required: requirement.required,
      upgradePrerequisite: requirement.upgradePrerequisite,
      active: requirement.active,
      sortOrder: requirement.sortOrder,
    })),
  };
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "operations.read");
    const scope = adminOrganizationWhere(
      admin,
      new URL(request.url).searchParams.get("organizationId"),
    );
    const items = await getPrisma().qualificationDefinition.findMany({
      where: scope,
      include: { requirements: { include: { position: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return jsonData(items.map(serialize), requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "operations.write", true);
    const input = await parseJson(
      request,
      definitionSchema.extend({ organizationId: z.string().uuid().optional() }),
    );
    const scopedOrganizationId = await resolveOrganizationTarget(admin, input.organizationId);
    const code = input.code ?? `custom-${Date.now().toString(36)}`;
    const duplicate = await getPrisma().qualificationDefinition.findUnique({
      where: { organizationId_code: { organizationId: scopedOrganizationId, code } },
    });
    if (duplicate) throw new ApiError("DUPLICATE_QUALIFICATION", "组织内资质 code 已存在", 409);
    const item = await getPrisma().qualificationDefinition.create({
      data: {
        organizationId: scopedOrganizationId,
        code,
        name: input.name,
        description: input.description,
        translations: input.translations,
        category: input.category,
        active: input.active,
        requiresEvidence: input.requiresEvidence,
        requiresHumanReview: input.requiresHumanReview,
        allowAutoApproval: input.allowAutoApproval,
        fieldSchema: input.fieldSchema as never,
        validityRule: input.validityRule,
        reminders: input.reminders,
        ocrChecks: input.ocrChecks,
        parameterRestriction: input.parameterRestriction,
        customizedAt: new Date(),
      },
      include: { requirements: { include: { position: true } } },
    });
    return jsonData(serialize(item), requestId, 201);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "operations.write", true);
    const scope = adminOrganizationWhere(
      admin,
      new URL(request.url).searchParams.get("organizationId"),
    );
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new ApiError("VALIDATION_ERROR", "缺少资质定义 ID", 422);
    const input = await parseJson(request, definitionSchema.omit({ code: true }));
    const current = await getPrisma().qualificationDefinition.findFirst({
      where: { id, ...scope },
    });
    if (!current) throw new ApiError("NOT_FOUND", "资质定义不存在", 404);
    const updated = await getPrisma().qualificationDefinition.updateMany({
      where: {
        id,
        ...scope,
        ...(input.expectedVersion ? { version: input.expectedVersion } : {}),
      },
      data: {
        name: input.name,
        description: input.description,
        translations: input.translations,
        category: input.category,
        active: input.active,
        requiresEvidence: input.requiresEvidence,
        requiresHumanReview: input.requiresHumanReview,
        allowAutoApproval: input.allowAutoApproval,
        fieldSchema: input.fieldSchema as never,
        validityRule: input.validityRule,
        reminders: input.reminders,
        ocrChecks: input.ocrChecks,
        parameterRestriction: input.parameterRestriction,
        customizedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1)
      throw new ApiError("VERSION_CONFLICT", "资质定义已被其他管理员修改", 409);
    const item = await getPrisma().qualificationDefinition.findUniqueOrThrow({
      where: { id },
      include: { requirements: { include: { position: true } } },
    });
    return jsonData(serialize(item), requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
