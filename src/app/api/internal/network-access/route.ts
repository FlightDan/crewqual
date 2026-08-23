import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ApiError, getRequestId, jsonError } from "@/server/api";
import { getServerConfig } from "@/server/config";
import { getPrisma } from "@/server/prisma";

export const runtime = "nodejs";

function secretMatches(request: NextRequest) {
  const expected = getServerConfig().NETWORK_ACCESS_SECRET;
  const provided = request.headers.get("x-crewqual-network-secret") ?? "";
  if (!expected || !provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  if (!secretMatches(request))
    return jsonError(new ApiError("NOT_FOUND", "Not found", 404), requestId);
  try {
    const policy = await getPrisma().securityPolicy.findUnique({ where: { id: "global" } });
    const allowed =
      policy?.allowPublicAccess ?? getServerConfig().DEPLOYMENT_NETWORK_MODE !== "lan";
    return new NextResponse(null, {
      status: allowed ? 204 : 403,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return jsonError(
      new ApiError("NETWORK_ACCESS_CHECK_FAILED", "访问策略检查失败", 503),
      requestId,
    );
  }
}
