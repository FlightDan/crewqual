import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { listMembers } from "@/server/member-repository";

const querySchema = z.object({
  q: z.string().trim().max(256).optional(),
  positions: z.string().trim().max(512).optional(),
  status: z.enum(["all", "active", "inactive"]).optional(),
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "pilots.read");
    const query = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    return jsonData(await listMembers(admin, query), requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
