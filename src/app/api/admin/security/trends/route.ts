import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";
import { querySecuritySummary } from "@/server/security-detection";
import { securityRangeInterval } from "@/server/security-query";

const querySchema = z.object({ range: z.enum(["24h", "7d", "30d"]).default("24h") }).strict();

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await getAdmin(request, "audit.read");
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    const { since, until } = securityRangeInterval(query.range);
    return jsonData(
      { range: query.range, ...(await querySecuritySummary(since, until, getPrisma())) },
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
