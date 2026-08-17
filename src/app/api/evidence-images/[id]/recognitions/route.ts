import { NextRequest } from "next/server";
import { assertSameOrigin, getRequestId, jsonData, jsonError } from "@/server/api";
import { assertCsrf, authenticatePilot } from "@/server/auth";
import { enqueueInTransaction, QUEUES } from "@/server/jobs";
import { getPrisma } from "@/server/prisma";
import { getRuntimeIntegration } from "@/server/runtime-settings";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const pilot = await authenticatePilot(request);
    await assertCsrf(request, pilot.csrfToken);
    const { id } = await context.params;
    const db = getPrisma();
    const image = await db.evidenceImage.findFirst({ where: { id, pilotId: pilot.id } });
    const owned = image;
    if (!owned) return jsonError(new Error("Evidence image not found"), requestId);
    const integration = await getRuntimeIntegration("vlm");
    const task = await db.$transaction(async (tx) => {
      const inserted = await tx.recognitionTask.createMany({
        data: [
          {
            evidenceImageId: id,
            taskType: "EXTRACTION",
            status: "QUEUED",
            retryLimit: integration.retryLimit,
            provider: integration.model || integration.adapter,
          },
        ],
        skipDuplicates: true,
      });
      const current = await tx.recognitionTask.findUniqueOrThrow({
        where: { evidenceImageId_taskType: { evidenceImageId: id, taskType: "EXTRACTION" } },
      });
      if (inserted.count === 1) {
        await enqueueInTransaction(tx, QUEUES.recognition, {
          recognitionId: current.id,
          evidenceImageId: id,
        });
      }
      return current;
    });
    return jsonData({ id: task.id, status: task.status }, requestId, 202);
  } catch (error) {
    return jsonError(error, requestId);
  }
}
