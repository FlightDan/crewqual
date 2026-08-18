import { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";
import { z } from "zod";
import { parseJson } from "@/server/api";
import { serializeNotification } from "@/server/serializers";
import { enqueueInTransaction, QUEUES } from "@/server/jobs";
import { relatedPilotUnitWhere } from "@/server/admin-permissions";

const schema = z.object({ expectedVersion: z.number().int().nonnegative().optional() });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "notifications.retry", true);
    const id = (await context.params).id;
    const db = getPrisma();
    const input = await parseJson(request, schema);
    const current = await db.notificationDelivery.findFirst({
      where: { id, ...relatedPilotUnitWhere(admin) },
    });
    if (!current) throw new ApiError("NOT_FOUND", "通知记录不存在", 404);
    if (!current.pilotId) throw new Error("Notification has no pilot target");
    if (!["FAILED", "UNKNOWN"].includes(current.status)) {
      throw new ApiError("INVALID_NOTIFICATION_STATE", "只有发送失败的通知可以重试", 409);
    }
    const delivery = await db.$transaction(async (tx) => {
      const updated = await tx.notificationDelivery.updateMany({
        where: {
          id,
          version: input.expectedVersion === undefined ? current.version : input.expectedVersion,
        },
        data: {
          status: "QUEUED",
          version: { increment: 1 },
          sentAt: null,
          startedAt: null,
          nextAttemptAt: null,
          attemptCount: 0,
          retryCycle: { increment: 1 },
          lastErrorCategory: null,
          finalFailureReason: null,
        },
      });
      if (updated.count !== 1) throw new Error("VERSION_CONFLICT");
      await tx.notificationAttempt.create({
        data: {
          deliveryId: current.id,
          attemptNumber: 0,
          retryCycle: current.retryCycle + 1,
          status: "QUEUED",
          detail: "管理员启动新的通知重试周期",
        },
      });
      await enqueueInTransaction(tx, QUEUES.notifications, {
        deliveryId: current.id,
        pilotId: current.pilotId,
        type: current.type,
      });
      await tx.auditEvent.create({
        data: {
          actorType: "admin",
          actorId: admin.id,
          action: "notification.retry",
          entityType: "NotificationDelivery",
          entityId: id,
          detail: { retryCycle: current.retryCycle + 1 },
          requestId,
        },
      });
      return tx.notificationDelivery.findUniqueOrThrow({
        where: { id },
        include: { attempts: true, pilot: true },
      });
    });
    return jsonData(serializeNotification(delivery), requestId, 202);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
