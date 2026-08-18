import { NextRequest } from "next/server";
import { boundedPositiveInt, getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "notifications.read");
    const url = new URL(request.url);
    const page = boundedPositiveInt(url.searchParams.get("page"), 1);
    const pageSize = boundedPositiveInt(url.searchParams.get("pageSize"), 20);
    const db = getPrisma();
    const where = { adminUserId: admin.id };
    const [total, unread, items] = await Promise.all([
      db.notificationDelivery.count({ where }),
      db.notificationDelivery.count({ where: { ...where, readAt: null } }),
      db.notificationDelivery.findMany({
        where,
        include: { pilot: { select: { displayName: true, employeeNumber: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return jsonData(
      {
        items: items.map((item) => ({
          id: item.id,
          type: item.type.toLowerCase(),
          status: item.status.toLowerCase(),
          summary: item.summary,
          message: item.message,
          pilotId: item.pilotId,
          pilotName: item.pilot?.displayName ?? "",
          employeeNumber: item.pilot?.employeeNumber ?? "",
          createdAt: item.createdAt.toISOString(),
          readAt: item.readAt?.toISOString() ?? null,
        })),
        total,
        unread,
        page,
        pageSize,
      },
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId);
  }
}
