import { NextRequest } from "next/server";
import { ApiError, getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";
import { serializeQualificationConfig } from "@/server/serializers";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    await getAdmin(request, "operations.read");
    const item = await getPrisma().qualificationType.findUnique({
      where: { id: (await context.params).id },
    });
    if (!item) throw new ApiError("NOT_FOUND", "资质配置不存在", 404);
    return jsonData(serializeQualificationConfig(item), requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
