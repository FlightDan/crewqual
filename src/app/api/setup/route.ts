import { NextRequest } from "next/server";
import { assertRemoteMode, getRequestId, jsonData, jsonError } from "@/server/api";
import { getSetupOverview } from "@/server/setup";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertRemoteMode();
    return jsonData(await getSetupOverview(), requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
