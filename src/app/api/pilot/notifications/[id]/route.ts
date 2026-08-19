import { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, getRequestId, jsonData, jsonError } from "@/server/api";
import { assertCsrf, authenticatePilot } from "@/server/auth";
import { getPrisma } from "@/server/prisma";
import { renderNotificationContent } from "@/lib/notification-i18n";

function serialize(item: {
  id: string;
  type: string;
  locale: string;
  templateKey: string;
  templateParams: unknown;
  createdAt: Date;
  readAt: Date | null;
}) {
  return {
    id: item.id,
    type: item.type.toLowerCase(),
    ...renderNotificationContent(item),
    createdAt: item.createdAt.toISOString(),
    readAt: item.readAt?.toISOString() ?? null,
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const pilot = await authenticatePilot(request);
    const item = await getPrisma().notificationDelivery.findFirst({
      where: {
        id: (await context.params).id,
        pilotId: pilot.id,
        channel: "IN_APP",
        type: { not: "DELIVERY_FAILED" },
      },
      select: {
        id: true,
        type: true,
        locale: true,
        templateKey: true,
        templateParams: true,
        createdAt: true,
        readAt: true,
      },
    });
    if (!item) throw new ApiError("NOT_FOUND", "通知不存在", 404);
    return jsonData(serialize(item), requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const pilot = await authenticatePilot(request);
    await assertCsrf(request, pilot.csrfToken);
    const id = (await context.params).id;
    const readAt = new Date();
    const updated = await getPrisma().notificationDelivery.updateMany({
      where: { id, pilotId: pilot.id, channel: "IN_APP", type: { not: "DELIVERY_FAILED" } },
      data: { readAt },
    });
    if (updated.count !== 1) throw new ApiError("NOT_FOUND", "通知不存在", 404);
    return jsonData({ id, read: true, readAt: readAt.toISOString() }, requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
