import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { assertSameOrigin, getRequestId, jsonData, jsonError } from "@/server/api";
import { assertCsrf, authenticatePilot, COOKIE_NAMES } from "@/server/auth";
import { getPrisma } from "@/server/prisma";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const pilot = await authenticatePilot(request);
    await assertCsrf(request, pilot.csrfToken);
    const db = getPrisma();
    await db.$transaction([
      db.auditEvent.create({
        data: {
          actorType: "pilot",
          actorId: pilot.id,
          pilotId: pilot.id,
          action: "pilot.logout",
          entityType: "PilotSession",
          entityId: pilot.sessionId,
          detail: {},
          requestId,
        },
      }),
      db.pilotSession.delete({ where: { id: pilot.sessionId } }),
    ]);
    const store = await cookies();
    for (const name of [
      COOKIE_NAMES.pilot,
      COOKIE_NAMES.member,
      `${COOKIE_NAMES.pilot}_csrf`,
      `${COOKIE_NAMES.member}_csrf`,
    ]) {
      store.delete(name);
    }
    return jsonData({ authenticated: false }, requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
