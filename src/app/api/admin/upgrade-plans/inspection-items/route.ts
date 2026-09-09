import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { getPrisma } from "@/server/prisma";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await getAdmin(request, "operations.read");
    const items = await getPrisma().inspectionItem.findMany({
      where: { active: true },
      orderBy: [{ name: "asc" }],
    });
    return jsonData(
      items.map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        description: item.description,
        ruleVersion: item.ruleVersion,
      })),
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
