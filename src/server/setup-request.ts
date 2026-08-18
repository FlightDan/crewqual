import { ApiError, assertRemoteMode, assertSameOrigin } from "@/server/api";
import { consumeRateLimit, requestAddress } from "@/server/rate-limit";

export async function guardSetupMutation(
  request: Request,
  action: string,
  limit = 20,
  windowMs = 15 * 60 * 1000,
) {
  assertRemoteMode();
  assertSameOrigin(request);
  const allowed = await consumeRateLimit(
    `setup:${action}:${requestAddress(request)}`,
    limit,
    windowMs,
  );
  if (!allowed) {
    throw new ApiError("RATE_LIMITED", "初始化请求过于频繁，请稍后重试", 429, undefined, {
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    });
  }
}
