import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getMember } from "@/server/member-repository";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ memberId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "pilots.read");
    const memberId = z
      .string()
      .uuid()
      .parse((await context.params).memberId);
    return jsonData(await getMember(admin, memberId), requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
