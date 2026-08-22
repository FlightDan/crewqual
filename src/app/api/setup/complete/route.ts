import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { completeSetup, setupCompleteSchema } from "@/server/setup";
import { guardSetupMutation, SETUP_AUTH_COOKIE } from "@/server/setup-request";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await guardSetupMutation(request, "complete", 5);
    const input = await parseJson(request, setupCompleteSchema);
    const response = jsonData(await completeSetup(input), requestId, 201);
    response.cookies.set({ name: SETUP_AUTH_COOKIE, value: "", maxAge: 0, path: "/" });
    return response;
  } catch (error) {
    return jsonError(error, requestId);
  }
}
