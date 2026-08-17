import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { authenticateAdmin } from "@/server/auth";
import { getPrisma } from "@/server/prisma";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await authenticateAdmin(request);
    const sessions = await getPrisma().adminSession.findMany({
      where: { userId: admin.id, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    });
    return jsonData(
      {
        id: admin.id,
        email: admin.email,
        displayName: admin.displayName,
        roles: admin.roles,
        permissions: admin.permissions,
        unit: admin.unitId ? { id: admin.unitId, name: admin.unitName ?? "所属单位" } : null,
        expiresAt: admin.expiresAt.toISOString(),
        sessions: sessions.map((session) => ({
          id: session.id,
          current: session.id === admin.sessionId,
          createdAt: session.createdAt.toISOString(),
          lastSeenAt: session.lastSeenAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
        })),
      },
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId);
  }
}
