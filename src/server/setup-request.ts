import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { ApiError, assertRemoteMode, assertSameOrigin } from "@/server/api";
import { getServerConfig } from "@/server/config";
import { safeEqualHex, sha256 } from "@/server/crypto";
import { consumeRateLimit, requestAddress } from "@/server/rate-limit";

export const SETUP_AUTH_COOKIE = "crewqual_setup_authorized";
const SETUP_AUTH_TTL_SECONDS = 30 * 60;

function setupCookieSignature(expiresAt: number) {
  return createHmac("sha256", getServerConfig().SESSION_SECRET)
    .update(`crewqual-setup:${expiresAt}`)
    .digest("hex");
}

function validSetupCookie(value: string | undefined) {
  if (!value) return false;
  const [expiresValue, signature] = value.split(".");
  const expiresAt = Number(expiresValue);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  if (!/^[a-f0-9]{64}$/.test(signature ?? "")) return false;
  return timingSafeEqual(
    Buffer.from(signature!, "hex"),
    Buffer.from(setupCookieSignature(expiresAt), "hex"),
  );
}

export function setupAuthorizationCookie() {
  const expiresAt = Math.floor(Date.now() / 1000) + SETUP_AUTH_TTL_SECONDS;
  return {
    name: SETUP_AUTH_COOKIE,
    value: `${expiresAt}.${setupCookieSignature(expiresAt)}`,
    httpOnly: true,
    secure: getServerConfig().APP_ORIGIN.startsWith("https:"),
    sameSite: "strict" as const,
    path: "/",
    maxAge: SETUP_AUTH_TTL_SECONDS,
  };
}

export async function authorizeSetup(request: Request, code: string) {
  assertRemoteMode();
  assertSameOrigin(request);
  const address = requestAddress(request);
  const [ipAllowed, globalAllowed] = await Promise.all([
    consumeRateLimit(`setup:authorization:${address}`, 5, 15 * 60 * 1000),
    consumeRateLimit("setup:authorization:global", 20, 15 * 60 * 1000),
  ]);
  if (!ipAllowed || !globalAllowed) {
    throw new ApiError("RATE_LIMITED", "授权尝试过于频繁，请稍后重试", 429, undefined, {
      retryAfterSeconds: 15 * 60,
    });
  }
  const normalized = code.trim();
  const configuredHash = getServerConfig().SETUP_AUTH_CODE_HASH.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(configuredHash)) {
    throw new ApiError(
      "SETUP_AUTH_UNAVAILABLE",
      "安装器尚未配置首次配置授权码，请联系主机管理员",
      503,
    );
  }
  if (!/^\d{8}$/.test(normalized) || !safeEqualHex(sha256(normalized), configuredHash)) {
    throw new ApiError("INVALID_SETUP_AUTH", "首次配置授权码无效", 403);
  }
}

export async function isSetupAuthorized() {
  if (getServerConfig().SERVICE_MODE === "mock") return true;
  const requestCookies = await cookies();
  return validSetupCookie(requestCookies.get(SETUP_AUTH_COOKIE)?.value);
}

export async function assertSetupAuthorized() {
  if (await isSetupAuthorized()) return;
  throw new ApiError("SETUP_AUTH_REQUIRED", "请输入安装完成后显示的首次配置授权码", 401);
}

export async function guardSetupMutation(
  request: Request,
  action: string,
  limit = 20,
  windowMs = 15 * 60 * 1000,
) {
  assertRemoteMode();
  assertSameOrigin(request);
  await assertSetupAuthorized();
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
