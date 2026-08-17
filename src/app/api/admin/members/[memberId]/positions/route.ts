import { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { assignPosition } from "@/server/position-assignments";

const schema = z.object({
  positionCode: z.string().trim().min(1).max(64),
  isPrimary: z.boolean().optional(),
  effectiveFrom: z.string().date().optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ memberId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "pilots.write", true);
    const { memberId } = await context.params;
    const input = await parseJson(request, schema);
    return jsonData(await assignPosition(admin, memberId, input), requestId, 201);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
