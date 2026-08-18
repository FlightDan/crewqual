import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { provisionSetupTotp } from "@/server/setup";
import { guardSetupMutation } from "@/server/setup-request";

const schema = z.object({ email: z.string().trim().email() });

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await guardSetupMutation(request, "totp-provision", 10);
    const input = await parseJson(request, schema);
    return jsonData(await provisionSetupTotp(input.email), requestId, 201);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
