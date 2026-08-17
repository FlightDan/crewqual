import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { listAdminReviews } from "@/server/admin-repository";

const querySchema = z.object({
  q: z.string().trim().max(256).optional(),
  status: z.enum(["all", "pending", "approved", "returned"]).optional(),
  ai: z.enum(["all", "matched", "question", "mismatch", "unavailable"]).optional(),
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "reviews.read");
    const url = new URL(request.url);
    const query = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    return jsonData(await listAdminReviews(admin, query), requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
