import { NextRequest } from "next/server";
import { ApiError, getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { querySecuritySummary } from "@/server/security-detection";
import { emptySecuritySummary } from "@/server/security-query";
import { getPrisma } from "@/server/prisma";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "audit.read");
    const db = getPrisma();
    const session = await db.adminSession.findFirst({
      where: { id: admin.sessionId, userId: admin.id },
      select: {
        createdAt: true,
        securitySummarySince: true,
        securitySummaryUntil: true,
      },
    });
    if (!session) throw new ApiError("UNAUTHENTICATED", "登录已失效，请重新登录", 401);
    if (!session.securitySummarySince || !session.securitySummaryUntil) {
      const state = await db.securityTelemetryState.findUnique({ where: { id: "global" } });
      return jsonData(
        { ...emptySecuritySummary(session.createdAt, state), sessionId: admin.sessionId },
        requestId,
      );
    }
    const summary = await querySecuritySummary(
      session.securitySummarySince,
      session.securitySummaryUntil,
      db,
    );
    return jsonData({ ...summary, sessionId: admin.sessionId }, requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
