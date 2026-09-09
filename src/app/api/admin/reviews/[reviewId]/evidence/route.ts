import { NextRequest, NextResponse } from "next/server";
import { ApiError, getRequestId, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getAdminReviewEvidence } from "@/server/admin-repository";
import { readVerifiedEvidence } from "@/server/storage";

/**
 * Stream a verified evidence object through the authenticated application
 * origin. Storage URLs and container hostnames must never be handed to the
 * review page, and authorization is checked again for every image request.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ reviewId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "reviews.read");
    const reviewId = (await context.params).reviewId;
    const evidence = await getAdminReviewEvidence(admin, reviewId);
    if (!evidence) throw new ApiError("NOT_FOUND", "证照不存在", 404);
    const bytes = await readVerifiedEvidence(evidence);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "content-type": evidence.mimeType,
        "content-length": String(bytes.byteLength),
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": "inline",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
