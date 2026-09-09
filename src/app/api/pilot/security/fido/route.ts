import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError } from "@/server/api";
import { assertCsrf, authenticatePilot, refreshPilotEnrollment } from "@/server/auth";
import { assertSameOrigin, getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { getPrisma } from "@/server/prisma";
import { createRegistrationOptions, verifyRegistration } from "@/server/webauthn";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("options") }),
  z.object({
    action: z.literal("verify"),
    challengeId: z.string().uuid(),
    response: z.unknown(),
    label: z.string().trim().max(128).optional(),
  }),
]);

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const pilot = await authenticatePilot(request, { allowPending: true });
    await assertCsrf(request, pilot.csrfToken);
    const input = await parseJson(request, actionSchema);
    const factorState = await getPrisma().pilot.findUniqueOrThrow({
      where: { id: pilot.id },
      select: { passwordHash: true, totpSecretCiphertext: true },
    });
    const existingFidoCount = await getPrisma().fidoCredential.count({
      where: { pilotId: pilot.id },
    });
    if (
      pilot.authState !== "AUTHENTICATED" &&
      (factorState.passwordHash || factorState.totpSecretCiphertext || existingFidoCount > 0)
    ) {
      throw new ApiError(
        "ENROLLMENT_REQUIRES_CURRENT_FACTORS",
        "已有认证因素的账号不能通过短信会话绑定硬件验证器",
        401,
      );
    }
    if (pilot.authState === "AUTHENTICATED" && existingFidoCount > 0) {
      throw new ApiError(
        "FIDO2_ALREADY_REGISTERED",
        "已有硬件验证器；请先通过受控恢复流程更换验证器",
        409,
      );
    }
    if (input.action === "options") {
      const credentials = await getPrisma().fidoCredential.findMany({
        where: { pilotId: pilot.id },
        select: { credentialId: true },
      });
      const created = await createRegistrationOptions({
        kind: "PILOT_REGISTRATION",
        ownerId: pilot.id,
        userName: pilot.employeeNumber,
        displayName: pilot.displayName,
        existingCredentialIds: credentials.map((item) => item.credentialId),
      });
      return jsonData({ ...created.options, challengeId: created.challengeId }, requestId);
    }
    const result = await verifyRegistration({
      kind: "PILOT_REGISTRATION",
      ownerId: pilot.id,
      challengeId: input.challengeId,
      response: input.response as never,
      label: input.label,
    });
    const authenticated = await refreshPilotEnrollment(pilot.sessionId, pilot.id);
    return jsonData({ ...result, authenticated }, requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
