import { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { endPositionAssignment } from "@/server/position-assignments";

const schema = z.object({ effectiveTo: z.string().date().optional() });

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ memberId: string; assignmentId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const admin = await getAdmin(request, "pilots.write", true);
    const params = await context.params;
    const memberId = z.string().uuid().parse(params.memberId);
    const assignmentId = z.string().uuid().parse(params.assignmentId);
    const input = await parseJson(request, schema);
    return jsonData(
      await endPositionAssignment(admin, memberId, assignmentId, input.effectiveTo),
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
