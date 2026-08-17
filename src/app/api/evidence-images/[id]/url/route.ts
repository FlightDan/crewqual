import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { authenticatePilot } from "@/server/auth";
import { getPrisma } from "@/server/prisma";
import { getPrivateEvidenceUrl } from "@/server/storage";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const pilot = await authenticatePilot(request);
    const { id } = await context.params;
    const image = await getPrisma().evidenceImage.findFirst({ where: { id, pilotId: pilot.id } });
    if (!image) throw new Error("Evidence not found");
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    return jsonData(
      {
        url: await getPrivateEvidenceUrl(image.objectKey, 300),
        expiresAt: expiresAt.toISOString(),
      },
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId);
  }
}
