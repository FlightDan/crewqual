import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { authenticatePilot } from "@/server/auth";
import { getPrisma } from "@/server/prisma";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const pilot = await authenticatePilot(request);
    const { id } = await context.params;
    const task = await getPrisma().recognitionTask.findFirst({
      where: {
        id,
        evidenceImage: { pilotId: pilot.id },
      },
    });
    if (!task) return jsonError(new Error("Recognition not found"), requestId);
    return jsonData({ id: task.id, status: task.status, result: task.result }, requestId);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
