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
import { authenticateAdmin } from "@/server/auth";
import { getPrisma } from "@/server/prisma";
import { consumeRateLimit, requestAddress } from "@/server/rate-limit";
import { getRuntimeSecurityPolicy } from "@/server/runtime-settings";
import { recordPublicSecuritySignal } from "@/server/security-request";
import { createAuthenticationOptions } from "@/server/webauthn";

const schema = z.object({ email: z.string().email() });

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  let accountIdentifier: string | null = null;
  let identity: {
    adminUserId: string;
    unitId: string | null;
    organizationId: string | null;
  } | null = null;
  try {
    assertSameOrigin(request);
    // This endpoint is also used before the login session exists. When a
    // session does exist, validate it so re-authentication remains bound to
    // the current administrator.
    const existingSession = await authenticateAdmin(request).catch(() => null);
    const input = await parseJson(request, schema);
    accountIdentifier = `admin:${input.email.toLowerCase()}`;
    const [addressAllowed, accountAllowed] = await Promise.all([
      consumeRateLimit(`admin-fido:address:${requestAddress(request)}`, 20, 15 * 60 * 1000),
      consumeRateLimit(`admin-fido:account:${input.email.toLowerCase()}`, 10, 15 * 60 * 1000),
    ]);
    if (!addressAllowed || !accountAllowed) {
      throw new ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试", 429);
    }
    const policy = await getRuntimeSecurityPolicy();
    if (!policy.adminFido2Required) {
      return jsonError(
        new Error("FIDO2 authentication is not required by the active security policy"),
        requestId,
      );
    }
    const user = await getPrisma().adminUser.findUnique({
      where: { email: input.email.toLowerCase() },
      select: { id: true, active: true, unitId: true, organizationId: true },
    });
    if (user) {
      identity = {
        adminUserId: user.id,
        unitId: user.unitId,
        organizationId: user.organizationId,
      };
    }
    if (!user?.active) {
      throw new ApiError("INVALID_CREDENTIALS", "账号或验证器不存在", 401);
    }
    const created = await createAuthenticationOptions({
      kind: "ADMIN_AUTHENTICATION",
      ownerId: user.id,
      sessionId: existingSession?.sessionId,
    });
    return jsonData({ ...created.options, challengeId: created.challengeId }, requestId);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 429)) {
      await recordPublicSecuritySignal(request, {
        kind: error.status === 429 ? "AUTH_RATE_LIMIT" : "AUTH_FAILURE",
        accountIdentifier,
        identity: identity ?? undefined,
        outcome: error.code,
      }).catch(() => undefined);
    }
    return jsonError(error, requestId, request);
  }
}
