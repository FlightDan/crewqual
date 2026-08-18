import { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "notifications.read", true);
    const id = (await context.params).id;
    const updated = await getPrisma().notificationDelivery.updateMany({
      where: { id, adminUserId: admin.id },
      data: { readAt: new Date() },
    });
    if (updated.count !== 1) throw new ApiError("NOT_FOUND", "通知不存在", 404);
    return jsonData({ read: true }, requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
