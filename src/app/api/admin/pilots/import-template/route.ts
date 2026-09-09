import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPilotCsvTemplate } from "@/server/pilot-management";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "pilots.write");
    return jsonData(await getPilotCsvTemplate(admin), requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
