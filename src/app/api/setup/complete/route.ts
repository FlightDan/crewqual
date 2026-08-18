import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { completeSetup, setupCompleteSchema } from "@/server/setup";
import { guardSetupMutation } from "@/server/setup-request";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await guardSetupMutation(request, "complete", 5);
    const input = await parseJson(request, setupCompleteSchema);
    return jsonData(await completeSetup(input), requestId, 201);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
