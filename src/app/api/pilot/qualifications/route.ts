import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { authenticatePilot } from "@/server/auth";
import { qualificationSectionDefinitions } from "@/lib/qualification-date-status";
import { listPilotQualifications } from "@/server/pilot-qualifications";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const pilot = await authenticatePilot(request);
    const qualifications = await listPilotQualifications(pilot.id);
    return jsonData(
      qualificationSectionDefinitions.map((section) => ({
        ...section,
        qualifications: qualifications.filter((item) => item.status === section.status),
      })),
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
