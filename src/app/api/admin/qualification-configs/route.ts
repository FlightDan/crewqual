import { NextRequest } from "next/server";
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
import { serializeQualificationConfig } from "@/server/serializers";
import {
  qualificationConfigCreateSchema,
  qualificationConfigPatchSchema,
} from "@/lib/admin-operations-validation";
/* eslint-disable @typescript-eslint/no-explicit-any */

const inputSchema = qualificationConfigPatchSchema;
const createSchema = qualificationConfigCreateSchema;

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await getAdmin(request, "operations.read");
    const items = await getPrisma().qualificationType.findMany({
      orderBy: [{ core: "desc" }, { name: "asc" }],
    });
    return jsonData(items.map(serializeQualificationConfig), requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "operations.write", true);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("id is required");
    const input = await parseJson(request, inputSchema);
    const current = await getPrisma().qualificationType.findUnique({ where: { id } });
    if (!current) throw new ApiError("NOT_FOUND", "资质配置不存在", 404);
    if (current.core && !input.active) {
      throw new ApiError("VALIDATION_ERROR", "六项核心资质不可停用", 422);
    }
    const item = await getPrisma().$transaction(async (tx) => {
      const updated = await tx.qualificationType.updateMany({
        where: {
          id,
          ...(input.expectedVersion === undefined ? {} : { version: input.expectedVersion }),
        },
        data: {
          active: input.active,
          parameterRestriction: input.parameterRestriction as any,
          validityRule: input.validityRule as any,
          reminders: input.reminders as any,
          ocrChecks: input.ocrChecks as any,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error("VERSION_CONFLICT");
      return tx.qualificationType.findUniqueOrThrow({ where: { id } });
    });
    await getPrisma().auditEvent.create({
      data: {
        actorType: "admin",
        actorId: admin.id,
        action: "qualification_config.updated",
        entityType: "QualificationType",
        entityId: id,
        detail: input as any,
        requestId,
      },
    });
    return jsonData(serializeQualificationConfig(item), requestId);
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
    const duplicateName = await getPrisma().qualificationType.findFirst({
      where: { name: { equals: input.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (duplicateName) throw new ApiError("DUPLICATE_QUALIFICATION", "资质名称已存在", 409);
    const code = input.code ?? `supplemental-${Date.now().toString(36)}`;
    const item = await getPrisma().qualificationType.create({
      data: {
        code,
        name: input.name,
        core: false,
        active: input.active,
        parameterRestriction: input.parameterRestriction as any,
        validityRule: input.validityRule as any,
        reminders: input.reminders as any,
        ocrChecks: input.ocrChecks as any,
      },
    });
    await getPrisma().auditEvent.create({
      data: {
        actorType: "admin",
        actorId: admin.id,
        action: "qualification_config.created",
        entityType: "QualificationType",
        entityId: item.id,
        detail: input as any,
        requestId,
      },
    });
    return jsonData(serializeQualificationConfig(item), requestId, 201);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
