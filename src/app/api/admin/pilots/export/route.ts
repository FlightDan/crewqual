import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPilotCsvExport } from "@/server/pilot-management";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "pilots.read");
    return jsonData(
      await getPilotCsvExport(admin, new URL(request.url).searchParams.get("unitId") ?? undefined),
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
