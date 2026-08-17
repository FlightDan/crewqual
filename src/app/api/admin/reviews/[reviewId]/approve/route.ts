import { NextRequest } from "next/server";
import { z } from "zod";
import {
  ApiError,
  assertSameOrigin,
  getRequestId,
  jsonData,
  jsonError,
  parseJson,
} from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { approveReview, getAdminReview } from "@/server/admin-repository";

const schema = z.object({
  expectedVersion: z.number().int().nonnegative().optional(),
  confirmed: z.literal(true),
  note: z.string().max(1000).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ reviewId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "reviews.decide", true);
    const input = await parseJson(request, schema);
    await approveReview(admin, (await context.params).reviewId, {
      ...input,
      requestId,
    });
    const review = await getAdminReview(admin, (await context.params).reviewId);
    if (!review) throw new ApiError("NOT_FOUND", "审核申请不存在", 404);
    return jsonData(review, requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
