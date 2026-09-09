import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";
import { relatedPilotUnitWhere } from "@/server/admin-permissions";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "notifications.read");
    const db = getPrisma();
    const scope = relatedPilotUnitWhere(admin);
    const today = new Date(new Date().setHours(0, 0, 0, 0));
    const [sentToday, failedToday, queued] = await Promise.all([
      db.notificationDelivery.count({
        where: { status: "SENT", createdAt: { gte: today }, ...scope },
      }),
      db.notificationDelivery.count({
        where: { status: "FAILED", createdAt: { gte: today }, ...scope },
      }),
      db.notificationDelivery.count({ where: { status: "QUEUED", ...scope } }),
    ]);
    return jsonData({ sentToday, failedToday, queued }, requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
