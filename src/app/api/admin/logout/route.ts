import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { assertSameOrigin, getRequestId, jsonData, jsonError } from "@/server/api";
import { COOKIE_NAMES, authenticateAdmin, assertCsrf } from "@/server/auth";
import { getPrisma } from "@/server/prisma";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await authenticateAdmin(request);
    await assertCsrf(request, admin.csrfToken);
    const db = getPrisma();
    await db.$transaction([
      db.auditEvent.create({
        data: {
          actorType: "admin",
          actorId: admin.id,
          action: "admin.logout",
          entityType: "AdminSession",
          entityId: admin.sessionId,
          detail: {},
          requestId,
        },
      }),
      db.adminSession.delete({ where: { id: admin.sessionId } }),
    ]);
    const store = await cookies();
    store.delete(COOKIE_NAMES.admin);
    store.delete(`${COOKIE_NAMES.admin}_csrf`);
    return jsonData({ authenticated: false }, requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
