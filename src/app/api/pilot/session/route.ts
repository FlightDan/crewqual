import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { assertSameOrigin, getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { authenticatePilot, consumePilotAccessToken, setSessionCookies } from "@/server/auth";
import { getPrisma } from "@/server/prisma";
import { pilotRoleLabel } from "@/lib/domain-i18n";
import { getRuntimeSecurityPolicy } from "@/server/runtime-settings";
import { recordPublicSecuritySignal } from "@/server/security-request";

const schema = z.object({ token: z.string().min(32).max(64) });

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const pilot = await authenticatePilot(request, { allowPending: true });
    const record = await getPrisma().pilot.findUnique({
      where: { id: pilot.id },
      include: { unit: true },
    });
    const policy = await getRuntimeSecurityPolicy();
    const response = jsonData(
      record
        ? {
            id: record.id,
            employeeNumber: record.employeeNumber,
            displayName: record.displayName,
            initials: record.initials,
            roleCode: record.roleCode,
            role: pilotRoleLabel(record.roleCode),
            unit: record.unit.name,
            authState: pilot.authState,
            memberLoginMode: policy.memberLoginMode,
            memberFido2Required: policy.memberFido2Required,
          }
        : null,
      requestId,
    );
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const { token } = await parseJson(request, schema);
    const session = await consumePilotAccessToken(token, requestId);
    await setSessionCookies(
      await cookies(),
      "pilot",
      session.rawToken,
      session.csrfToken,
      Math.max(1, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
    );
    const response = jsonData(
      {
        authenticated: true,
        authState: session.authState,
        expiresAt: session.expiresAt.toISOString(),
      },
      requestId,
    );
    response.headers.set("cache-control", "no-store");
    response.headers.set("referrer-policy", "no-referrer");
    if (session.authState === "AUTHENTICATED") {
      await recordPublicSecuritySignal(request, {
        kind: "AUTH_SUCCESS",
        identity: {
          pilotId: session.pilotId,
          personId: session.personId,
          unitId: session.unitId,
        },
        outcome: "AUTHENTICATED",
      }).catch(() => undefined);
    }
    return response;
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
