import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { authenticatePilot } from "@/server/auth";
import { getPrisma } from "@/server/prisma";
import { toSubmissionStatus } from "@/server/submission-status";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const pilot = await authenticatePilot(request);
    const { id } = await context.params;
    const submission = await getPrisma().qualificationUpdateRequest.findFirst({
      where: { id, pilotId: pilot.id },
      include: { qualificationType: true },
    });
    if (!submission) return jsonError(new Error("Submission not found"), requestId);
    return jsonData(
      {
        id: submission.id,
        qualificationId: submission.qualificationType.code,
        qualificationName: submission.qualificationType.name,
        qualificationTranslations: submission.qualificationType.translations,
        submittedAt: submission.submittedAt.toISOString(),
        status: toSubmissionStatus(submission.status),
        notifications: ["system"],
        ...(submission.decisionNote ? { decisionNote: submission.decisionNote } : {}),
        ...(submission.returnReason ? { returnReason: submission.returnReason } : {}),
      },
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId, request);
  }
}
