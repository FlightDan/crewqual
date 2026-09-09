import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { getPrisma } from "@/server/prisma";
import { guardSetupMutation, SETUP_AUTH_COOKIE } from "@/server/setup-request";
import { createRegistrationOptions, verifyRegistration } from "@/server/webauthn";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("options"), adminEmail: z.string().email() }),
  z.object({
    action: z.literal("verify"),
    adminEmail: z.string().email(),
    challengeId: z.string().uuid(),
    response: z.unknown(),
    label: z.string().trim().max(128).optional(),
  }),
]);

async function setupAdmin(email: string) {
  const admin = await getPrisma().adminUser.findFirst({
    where: {
      email: email.toLowerCase(),
      active: true,
      roles: { some: { role: { code: "SUPER_ADMIN" } } },
    },
    select: { id: true, email: true, displayName: true },
  });
  if (!admin) throw new Error("初始化管理员不存在");
  return admin;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await guardSetupMutation(request, "fido", 10);
    const input = await parseJson(request, schema);
    const admin = await setupAdmin(input.adminEmail);
    if (input.action === "options") {
      const credentials = await getPrisma().fidoCredential.findMany({
        where: { adminUserId: admin.id },
        select: { credentialId: true },
      });
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
      label: input.label ?? "初始化管理员硬件验证器",
    });
    const response = jsonData(result, requestId);
    response.cookies.set({ name: SETUP_AUTH_COOKIE, value: "", maxAge: 0, path: "/" });
    return response;
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
