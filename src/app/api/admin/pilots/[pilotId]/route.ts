import { NextRequest } from "next/server";
import { ApiError, getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getAdminPilot } from "@/server/admin-repository";
import { updateAdminPilot } from "@/server/pilot-management";
import { pilotUpdateInputSchema } from "@/lib/pilot-management-validation";

export async function GET(request: NextRequest, context: { params: Promise<{ pilotId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "pilots.read");
    const pilot = await getAdminPilot(admin, (await context.params).pilotId);
    if (!pilot) throw new ApiError("NOT_FOUND", "飞行员档案不存在", 404);
    return jsonData(pilot, requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ pilotId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "pilots.write", true);
    const input = await parseJson(request, pilotUpdateInputSchema);
    return jsonData(
      await updateAdminPilot(admin, (await context.params).pilotId, input, requestId),
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId);
  }
}
