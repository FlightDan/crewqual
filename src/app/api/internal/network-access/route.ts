import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ApiError, getRequestId, jsonError } from "@/server/api";
import { getServerConfig } from "@/server/config";
import { getPrisma } from "@/server/prisma";
import { recordSecurityCollectionGap, recordSecuritySignal } from "@/server/security-events";
import { sealPublicRequestKey } from "@/server/security-request";
import { classifySecurityRoute } from "@/server/security-route-classifier";

export const runtime = "nodejs";

function secretMatches(request: NextRequest) {
  const expected = getServerConfig().NETWORK_ACCESS_SECRET;
  const provided = request.headers.get("x-crewqual-network-secret") ?? "";
  if (!expected || !provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

const requestKeyPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const methodPattern = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

function ingressContext(request: NextRequest) {
  const requestKey = request.headers.get("x-crewqual-request-key")?.trim() ?? "";
  const method = request.headers.get("x-crewqual-original-method")?.trim() ?? "";
  const pathname = request.headers.get("x-crewqual-original-path")?.trim() ?? "";
  const address = request.headers.get("x-crewqual-remote-ip")?.trim() ?? "";
  if (
    !requestKeyPattern.test(requestKey) ||
    !methodPattern.test(method) ||
    !pathname.startsWith("/") ||
    pathname.length > 2_048 ||
    pathname.includes("?") ||
    pathname.includes("#") ||
    /[\r\n\0]/.test(pathname)
  ) {
    throw new ApiError("NETWORK_ACCESS_CONTEXT_INVALID", "访问策略上下文无效", 503);
  }
  return { requestKey, method, pathname, address };
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  if (!secretMatches(request))
    return jsonError(new ApiError("NOT_FOUND", "Not found", 404), requestId);
  try {
    const context = ingressContext(request);
    const db = getPrisma();
    const classification = classifySecurityRoute(context.pathname, context.method);
    const sealedRequestKey = sealPublicRequestKey(
      context.requestKey,
      classification.routeClass,
      context.method,
      context.pathname,
    );
    const policy = await db.securityPolicy.findUnique({ where: { id: "global" } });
    const allowed =
      policy?.allowPublicAccess ?? getServerConfig().DEPLOYMENT_NETWORK_MODE !== "lan";
    const terminalKind = classification.terminalKind ?? (allowed ? null : "PUBLIC_ACCESS_DENIED");
    if (terminalKind) {
      await recordSecuritySignal(
        {
          requestKey: sealedRequestKey,
          kind: terminalKind,
          address: context.address,
          routeClass: classification.routeClass,
          pathname: context.pathname,
          outcome: allowed
            ? classification.outcome
            : `${classification.outcome}_PUBLIC_DENIED`.slice(0, 64),
        },
        db,
      );
    }
    return new NextResponse(null, {
      status: allowed ? 204 : 403,
      headers: {
        "cache-control": "no-store",
        ...(allowed
          ? {
              "x-crewqual-request-key": sealedRequestKey,
              "x-crewqual-route-class": classification.routeClass,
            }
          : {}),
      },
    });
  } catch {
    await recordSecurityCollectionGap("PREFLIGHT_FAILED").catch(() => undefined);
    return jsonError(
      new ApiError("NETWORK_ACCESS_CHECK_FAILED", "访问策略检查失败", 503),
      requestId,
    );
  }
}
