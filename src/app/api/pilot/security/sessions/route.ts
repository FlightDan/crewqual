import { NextRequest } from "next/server";
import { z } from "zod";
import {
  ApiError,
  assertSameOrigin,
  getRequestId,
  jsonData,
  jsonError,
  parseJson,
} from "@/server/api";
import { assertCsrf, authenticatePilot } from "@/server/auth";
import { getPrisma } from "@/server/prisma";

const revokeSchema = z.object({ id: z.string().uuid() });

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const pilot = await authenticatePilot(request, { allowPending: true });
    const sessions = await getPrisma().pilotSession.findMany({
      where: { pilotId: pilot.id, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      take: 50,
      select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true },
    });
    return jsonData(
      sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        current: session.id === pilot.sessionId,
      })),
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const pilot = await authenticatePilot(request, { allowPending: true });
    await assertCsrf(request, pilot.csrfToken);
    const input = await parseJson(request, revokeSchema);
    if (input.id === pilot.sessionId)
      throw new ApiError("SELF_LOCKOUT", "请使用退出登录结束当前会话", 409);
    const deleted = await getPrisma().pilotSession.deleteMany({
      where: { id: input.id, pilotId: pilot.id },
    });
    if (deleted.count !== 1) throw new ApiError("NOT_FOUND", "会话不存在", 404);
    await getPrisma().auditEvent.create({
      data: {
        actorType: "pilot",
        pilotId: pilot.id,
        action: "pilot.session.revoked",
        entityType: "PilotSession",
        entityId: input.id,
        detail: {},
        requestId,
      },
    });
    return jsonData({ revoked: true }, requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
