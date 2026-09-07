import { NextRequest } from "next/server";
import { ApiError, getRequestId, jsonData, jsonError } from "@/server/api";
import { authenticatePilot } from "@/server/auth";
import { listPilotQualifications } from "@/server/pilot-qualifications";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ qualificationId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const pilot = await authenticatePilot(request);
    const { qualificationId } = await context.params;
    const qualifications = await listPilotQualifications(pilot.id);
    const qualification = qualifications.find((item) => item.id === qualificationId);
    if (!qualification) throw new ApiError("NOT_FOUND", "资质项目不存在或未分配给当前成员", 404);
    return jsonData(qualification, requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
