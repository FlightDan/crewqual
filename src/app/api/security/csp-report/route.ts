import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getPrisma } from "@/server/prisma";
import { consumeRateLimit, requestAddress } from "@/server/rate-limit";

function safeString(value: unknown, max = 256) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : "";
}

function safeUri(value: unknown) {
  const raw = safeString(value, 1024);
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`.slice(0, 512);
  } catch {
    return raw.split(/[?#]/, 1)[0]!.slice(0, 512);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 16 * 1024) return new Response(null, { status: 413 });
    if (!(await consumeRateLimit(`csp-report:${requestAddress(request)}`, 30, 60 * 1000))) {
      return new Response(null, { status: 204 });
    }
    const body = await request.text();
    if (body.length > 16 * 1024) return new Response(null, { status: 413 });
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return new Response(null, { status: 204 });
    }
    const report =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? ((parsed as Record<string, unknown>).body ?? parsed)
        : {};
    const detail = report && typeof report === "object" ? (report as Record<string, unknown>) : {};
    await getPrisma().auditEvent.create({
      data: {
        actorType: "system",
        action: "security.csp_violation",
        entityType: "SecurityReport",
        entityId: requestId,
        detail: {
          documentUri: safeUri(detail["document-uri"] ?? detail.documentURL),
          blockedUri: safeUri(detail["blocked-uri"] ?? detail.blockedURL),
          effectiveDirective: safeString(
            detail["effective-directive"] ?? detail.effectiveDirective,
            128,
          ),
          disposition: safeString(detail.disposition, 32),
        },
        requestId,
      },
    });
    return jsonData({ accepted: true }, requestId, 202);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
