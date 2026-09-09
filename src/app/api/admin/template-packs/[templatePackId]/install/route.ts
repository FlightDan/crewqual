import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { resolveOrganizationTarget } from "@/server/admin-organization-scope";
import { installTemplatePack } from "@/server/template-packs";

const installSchema = z.object({ organizationId: z.string().uuid().optional() });

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templatePackId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "settings.units.write", true);
    const { templatePackId } = await context.params;
    const input = await parseJson(request, installSchema);
    const organizationId = await resolveOrganizationTarget(admin, input.organizationId);
    return jsonData(await installTemplatePack(organizationId, templatePackId, admin.id), requestId);
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
