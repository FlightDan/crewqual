import { NextRequest } from "next/server";
import { ApiError, getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getAdminReview } from "@/server/admin-repository";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ reviewId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "reviews.read");
    const review = await getAdminReview(admin, (await context.params).reviewId);
    if (!review) throw new ApiError("NOT_FOUND", "审核申请不存在", 404);
    return jsonData(review, requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
