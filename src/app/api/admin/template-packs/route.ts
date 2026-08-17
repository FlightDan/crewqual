import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, getRequestId, jsonData, jsonError, parseJson } from "@/server/api";
import { getAdmin } from "@/server/admin-guard";
import { isSuperAdmin } from "@/server/admin-permissions";
import { getPrisma } from "@/server/prisma";
import { registerTemplatePack, templatePackSchema } from "@/server/template-packs";

const registerSchema = z.object({ pack: templatePackSchema });

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "settings.read");
    const organizationId = admin.organizationId ?? admin.unitId;
    const packs = await getPrisma().templatePack.findMany({
      where: { active: true },
      orderBy: [{ code: "asc" }, { version: "desc" }],
      include: {
        installations: organizationId
          ? {
              where: { organizationId },
              select: { id: true, status: true, installedAt: true, result: true },
            }
          : false,
      },
    });
    return jsonData(
      packs.map((pack) => ({
        id: pack.id,
        code: pack.code,
        version: pack.version,
        industryCode: pack.industryCode,
        name: pack.name,
        description: pack.description,
        translations: pack.translations,
        checksum: pack.checksum,
        installations: pack.installations,
      })),
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await getAdmin(request, "settings.units.write", true);
    if (!isSuperAdmin(admin)) {
      throw new ApiError("FORBIDDEN", "只有超级管理员可以注册模板包", 403);
    }
    const input = await parseJson(request, registerSchema);
    return jsonData(await registerTemplatePack(input.pack), requestId, 201);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
