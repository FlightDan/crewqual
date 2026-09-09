import { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { correctReview } from "@/server/admin-repository";
import { reviewCredentialFieldsSchema } from "@/lib/admin-review-validation";

const schema = reviewCredentialFieldsSchema.extend({
  expectedVersion: z.number().int().nonnegative().optional(),
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
    const { expectedVersion, ...patch } = input;
    const result = await correctReview(
      admin,
      (await context.params).reviewId,
      patch,
      expectedVersion,
      requestId,
    );
    return jsonData(result, requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
