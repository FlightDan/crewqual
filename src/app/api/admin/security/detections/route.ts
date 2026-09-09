import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";
import { querySecurityDetections } from "@/server/security-query";

const querySchema = z
  .object({
    range: z.enum(["24h", "7d", "30d"]).default("24h"),
    page: z.coerce.number().int().positive().max(10_000).default(1),
    pageSize: z.coerce.number().int().positive().max(50).default(20),
  })
  .strict();

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "audit.read");
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    return jsonData(await querySecurityDetections({ ...query, admin }, getPrisma()), requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
