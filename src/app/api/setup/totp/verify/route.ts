import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { verifySetupTotp } from "@/server/setup";
import { guardSetupMutation } from "@/server/setup-request";

const schema = z.object({
  email: z.string().trim().email(),
  code: z.string().regex(/^\d{6}$/),
  enrollmentToken: z.string().min(1).max(4096),
});

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await guardSetupMutation(request, "totp-verify", 20);
    const input = await parseJson(request, schema);
    return jsonData(await verifySetupTotp(input), requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
