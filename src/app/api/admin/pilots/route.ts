import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { listAdminPilots } from "@/server/admin-repository";
import { createAdminPilot } from "@/server/pilot-management";
import { pilotManagementInputSchema } from "@/lib/pilot-management-validation";

const querySchema = z.object({
  q: z.string().trim().max(256).optional(),
  health: z
    .enum(["all", "normal", "expiring", "expired", "missing", "incomplete", "unconfigured"])
    .optional(),
  upgrade: z.enum(["all", "active", "none"]).optional(),
  status: z.enum(["all", "active", "inactive"]).optional(),
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "pilots.read");
    const url = new URL(request.url);
    const query = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    return jsonData(await listAdminPilots(admin, query), requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "pilots.write", true);
    const input = await parseJson(request, pilotManagementInputSchema);
    return jsonData(await createAdminPilot(admin, input, requestId), requestId, 201);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
