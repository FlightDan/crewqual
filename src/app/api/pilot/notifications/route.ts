import { NextRequest } from "next/server";
import { boundedPositiveInt, getRequestId, jsonData, jsonError } from "@/server/api";
import { authenticatePilot } from "@/server/auth";
import { getPrisma } from "@/server/prisma";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const pilot = await authenticatePilot(request);
    const url = new URL(request.url);
    const page = boundedPositiveInt(url.searchParams.get("page"), 1);
    const pageSize = Math.min(100, boundedPositiveInt(url.searchParams.get("pageSize"), 20));
    const where = {
      pilotId: pilot.id,
      channel: "IN_APP" as const,
      type: { not: "DELIVERY_FAILED" as const },
    };
    const db = getPrisma();
    const [total, unreadCount, items] = await Promise.all([
      db.notificationDelivery.count({ where }),
      db.notificationDelivery.count({ where: { ...where, readAt: null } }),
      db.notificationDelivery.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          type: true,
          summary: true,
          message: true,
          createdAt: true,
          readAt: true,
        },
      }),
    ]);
    return jsonData(
      {
        items: items.map((item) => ({
          ...item,
          type: item.type.toLowerCase(),
          createdAt: item.createdAt.toISOString(),
          readAt: item.readAt?.toISOString() ?? null,
        })),
        total,
        unreadCount,
        page,
        pageSize,
      },
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId);
  }
}
