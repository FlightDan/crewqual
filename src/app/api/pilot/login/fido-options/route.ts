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
import { authenticatePilot } from "@/server/auth";
import { getPrisma } from "@/server/prisma";
import { consumeRateLimit, requestAddress } from "@/server/rate-limit";
import { getRuntimeSecurityPolicy } from "@/server/runtime-settings";
import { recordPublicSecuritySignal } from "@/server/security-request";
import { createAuthenticationOptions } from "@/server/webauthn";

const schema = z.object({ employeeNumber: z.string().trim().min(1).max(64) });

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  let accountIdentifier: string | null = null;
  let identity: {
    pilotId: string;
    personId: string | null;
    unitId: string;
    organizationId: string | null;
  } | null = null;
  try {
    assertSameOrigin(request);
    // Login-time challenges are public before a session exists; an existing
    // session is still checked when the endpoint is used for re-authentication.
    const existingSession = await authenticatePilot(request).catch(() => null);
    const input = await parseJson(request, schema);
    accountIdentifier = `member:${input.employeeNumber.toLowerCase()}`;
    const [addressAllowed, accountAllowed] = await Promise.all([
      consumeRateLimit(`pilot-fido:address:${requestAddress(request)}`, 20, 15 * 60 * 1000),
      consumeRateLimit(
        `pilot-fido:account:${input.employeeNumber.toLowerCase()}`,
        10,
        15 * 60 * 1000,
      ),
    ]);
    if (!addressAllowed || !accountAllowed) {
      throw new ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试", 429);
    }
    const policy = await getRuntimeSecurityPolicy();
    if (!policy.memberFido2Required) {
      return jsonError(new Error("FIDO2 is not required by the active security policy"), requestId);
    }
    const pilot = await getPrisma().pilot.findUnique({
      where: { employeeNumber: input.employeeNumber },
      include: { unit: { select: { organizationId: true } } },
    });
    if (pilot) {
      identity = {
        pilotId: pilot.id,
        personId: pilot.personId,
        unitId: pilot.unitId,
        organizationId: pilot.unit.organizationId,
      };
    }
    if (!pilot?.active) {
      throw new ApiError("INVALID_CREDENTIALS", "人员或验证器不存在", 401);
    }
    const created = await createAuthenticationOptions({
      kind: "PILOT_AUTHENTICATION",
      ownerId: pilot.id,
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
