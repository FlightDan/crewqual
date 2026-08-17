import { NextRequest } from "next/server";
import { ApiError, getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";
import { serializeNotification } from "@/server/serializers";
import { relatedPilotUnitWhere } from "@/server/admin-permissions";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "notifications.read");
    const item = await getPrisma().notificationDelivery.findFirst({
      where: { id: (await context.params).id, ...relatedPilotUnitWhere(admin) },
      include: { attempts: true, pilot: true },
    });
    if (!item) throw new ApiError("NOT_FOUND", "通知记录不存在", 404);
    return jsonData(serializeNotification(item), requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
