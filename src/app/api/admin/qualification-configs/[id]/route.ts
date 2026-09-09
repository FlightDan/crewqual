import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";
import { adminOrganizationWhere } from "@/server/admin-organization-scope";
import { customFieldsFromFieldSchema } from "@/lib/qualification-fields";

const positionCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_-]{0,63}$/);

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "operations.read");
    const positionCode = positionCodeSchema.parse(
      new URL(request.url).searchParams.get("positionCode"),
    );
    const scope = adminOrganizationWhere(
      admin,
      new URL(request.url).searchParams.get("organizationId"),
    );
    const item = await getPrisma().qualificationRequirement.findFirst({
      where: {
        id: (await context.params).id,
        position: {
          code: positionCode,
          ...scope,
        },
      },
      include: { position: true, qualificationDefinition: true },
    });
    if (!item) throw new ApiError("NOT_FOUND", "资质配置不存在", 404);
    const definition = item.qualificationDefinition;
    return jsonData(
      {
        id: item.id,
        qualificationId: definition.id,
        positionCode: item.position.code,
        organizationId: item.position.organizationId,
        code: definition.code,
        name: definition.name,
        translations: definition.translations ?? {},
        core: item.required && item.upgradePrerequisite,
        locked: Boolean(item.sourcePackCode),
        active: item.active && definition.active,
        customFields: customFieldsFromFieldSchema(definition.fieldSchema),
        parameterRestriction: definition.parameterRestriction,
        validityRule: definition.validityRule,
        reminders: definition.reminders,
        ocrChecks: definition.ocrChecks,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        version: item.version,
      },
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
