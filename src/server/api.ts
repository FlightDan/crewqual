import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerConfig } from "@/server/config";
import { ApiError } from "@/server/api-error";

export { ApiError } from "@/server/api-error";

export type ApiSuccess<T> = { data: T; requestId: string };
export type ApiFailure = {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
    details?: unknown;
    requestId: string;
  };
};

export function assertRemoteMode() {
  if (getServerConfig().SERVICE_MODE === "mock") {
    throw new ApiError("MOCK_MODE_DISABLED", "Mock mode does not expose backend APIs", 404);
  }
}

export function getRequestId(request: Request): string {
  return request.headers.get("x-request-id")?.trim() || randomUUID();
}

export function boundedPositiveInt(value: string | null, fallback: number, maximum = 100) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function jsonData<T>(data: T, requestId: string, status = 200) {
  return NextResponse.json<ApiSuccess<T>>(
    { data, requestId },
    { status, headers: { "x-request-id": requestId, "cache-control": "no-store" } },
  );
}

export function jsonError(error: unknown, requestId: string) {
  const isPrismaUniqueConstraint =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002";
  const isActiveQualificationConflict =
    isPrismaUniqueConstraint &&
    String((error as { meta?: { target?: unknown } }).meta?.target ?? "").includes(
      "QualificationRecord_one_active_per_pilot_type",
    );
  const normalized =
    error instanceof ApiError
      ? error
      : error instanceof z.ZodError
        ? new ApiError("VALIDATION_ERROR", "请求参数不合法", 422, error.flatten().fieldErrors)
        : error instanceof Error && /VERSION_CONFLICT/i.test(error.message)
          ? new ApiError("VERSION_CONFLICT", "数据已被其他操作更新，请刷新后重试", 409)
          : error instanceof Error && /not found/i.test(error.message)
            ? new ApiError("NOT_FOUND", "请求的数据不存在", 404)
            : error instanceof Error && /DUPLICATE_SUBMISSION/i.test(error.message)
              ? new ApiError("DUPLICATE_SUBMISSION", "该资质已有待处理申请", 409)
              : isActiveQualificationConflict
                ? new ApiError("DUPLICATE_ACTIVE_QUALIFICATION", "该人员已有生效中的同类资质", 409)
                : isPrismaUniqueConstraint
                  ? new ApiError("CONFLICT", "数据已存在或已被其他操作更新", 409)
                  : error instanceof Error && /EVIDENCE_UNAVAILABLE/i.test(error.message)
                    ? new ApiError("EVIDENCE_UNAVAILABLE", "该凭证已提交或不可用", 409)
                    : error instanceof Error &&
                        /only image\/jpeg|invalid image|jpeg/i.test(error.message)
                      ? new ApiError("INVALID_IMAGE", error.message, 422)
                      : new ApiError("INTERNAL_ERROR", "服务暂时不可用", 500);
  const body: ApiFailure = {
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.fieldErrors ? { fieldErrors: normalized.fieldErrors } : {}),
      ...(normalized.details !== undefined ? { details: normalized.details } : {}),
      requestId,
    },
  };
  const retryAfter =
    normalized.details &&
    typeof normalized.details === "object" &&
    "retryAfterSeconds" in normalized.details
      ? String((normalized.details as { retryAfterSeconds: number }).retryAfterSeconds)
      : undefined;
  return NextResponse.json(body, {
    status: normalized.status,
    headers: {
      "x-request-id": requestId,
      "cache-control": "no-store",
      ...(retryAfter ? { "retry-after": retryAfter } : {}),
    },
  });
}

export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("INVALID_JSON", "请求体不是合法 JSON", 400);
  }
  return schema.parse(body);
}

export function assertSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  // Resolve the configured origin through the validated server configuration.
  // Reading process.env directly here made an unset APP_ORIGIN silently accept
  // every cross-site Origin header.
  const configuredOrigin = getServerConfig().APP_ORIGIN;
  if (!origin || origin !== configuredOrigin) {
    throw new ApiError("ORIGIN_MISMATCH", "请求来源无效", 403);
  }
}

export function assertExpectedVersion(actual: number, expected: number | undefined) {
  if (expected !== undefined && actual !== expected) {
    throw new ApiError("VERSION_CONFLICT", "数据已被其他操作更新，请刷新后重试", 409);
  }
}
