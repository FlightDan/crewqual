import { NextRequest } from "next/server";
import { z } from "zod";
import { boundedPositiveInt, getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";
import { relatedPilotUnitWhere } from "@/server/admin-permissions";
import { serializeNotification } from "@/server/serializers";
/* eslint-disable @typescript-eslint/no-explicit-any */

const querySchema = z.object({
  status: z.string().trim().max(32).optional(),
  type: z.string().trim().max(64).optional(),
  channel: z.enum(["all", "feishu", "sms", "in_app"]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  q: z.string().trim().max(256).optional(),
});

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "notifications.read");
    const url = new URL(request.url);
    const query = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const page = boundedPositiveInt(url.searchParams.get("page"), 1);
    const pageSize = boundedPositiveInt(url.searchParams.get("pageSize"), 20);
    const db = getPrisma();
    const scope = relatedPilotUnitWhere(admin);
    const where: any = {
      ...scope,
      ...(query.status && query.status !== "all" ? { status: query.status.toUpperCase() } : {}),
      ...(query.type && query.type !== "all" ? { type: query.type.toUpperCase() } : {}),
      ...(query.channel && query.channel !== "all" ? { channel: query.channel.toUpperCase() } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { templateKey: { contains: query.q, mode: "insensitive" } },
              { target: { contains: query.q, mode: "insensitive" } },
              {
                pilot: {
                  displayName: { contains: query.q, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const [total, items, sentToday, failedToday, queued] = await Promise.all([
      db.notificationDelivery.count({ where }),
      db.notificationDelivery.findMany({
        where,
        include: { pilot: true, attempts: { orderBy: { attemptedAt: "desc" } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.notificationDelivery.count({
        where: {
          status: "SENT",
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          ...scope,
        },
      }),
      db.notificationDelivery.count({
        where: {
          status: "FAILED",
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          ...scope,
        },
      }),
      db.notificationDelivery.count({ where: { status: "QUEUED", ...scope } }),
    ]);
    return jsonData(
      {
        items: items.map(serializeNotification),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        summary: { sentToday, failedToday, queued },
      },
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
