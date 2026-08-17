import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { pilotCsvRequestSchema } from "@/lib/pilot-management-validation";
import { importPilotCsv } from "@/server/pilot-management";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "pilots.write", true);
    const { csvText, mode, confirmMerge } = await parseJson(request, pilotCsvRequestSchema);
    return jsonData(
      await importPilotCsv(admin, csvText, requestId, mode, confirmMerge),
      requestId,
      201,
    );
  } catch (error) {
    return jsonError(error, requestId);
  }
}
