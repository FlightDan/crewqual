import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError } from "@/server/api";
import { assertCsrf, authenticateAdmin, requirePermission } from "@/server/auth";
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
    const admin = await authenticateAdmin(request);
    requirePermission(admin, "settings.security.write");
    await assertCsrf(request, admin.csrfToken);
    const input = await parseJson(request, actionSchema);
    if (input.action === "options") {
      const credentials = await getPrisma().fidoCredential.findMany({
        where: { adminUserId: admin.id },
        select: { credentialId: true },
      });
      if (credentials.length > 0) {
        throw new ApiError(
          "FIDO2_ALREADY_REGISTERED",
          "已有硬件验证器；请先通过受控恢复流程更换验证器",
          409,
        );
      }
      const created = await createRegistrationOptions({
        kind: "ADMIN_REGISTRATION",
        ownerId: admin.id,
        userName: admin.email,
        displayName: admin.displayName,
        existingCredentialIds: credentials.map((item) => item.credentialId),
      });
      return jsonData({ ...created.options, challengeId: created.challengeId }, requestId);
    }
    const result = await verifyRegistration({
      kind: "ADMIN_REGISTRATION",
      ownerId: admin.id,
      challengeId: input.challengeId,
      response: input.response as never,
      label: input.label,
    });
    return jsonData(result, requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
