import { NextRequest } from "next/server";
import { ApiError, getRequestId, jsonData, jsonError } from "@/server/api";
import { authenticatePilot } from "@/server/auth";
import { deriveQualification } from "@/lib/qualification-date-status";
import { getPrisma } from "@/server/prisma";
import { parseValidityRule } from "@/lib/qualification-rules";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ qualificationId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const pilot = await authenticatePilot(request);
    const { qualificationId } = await context.params;
    const record = await getPrisma().qualificationRecord.findFirst({
      where: { pilotId: pilot.id, status: "ACTIVE", qualificationType: { code: qualificationId } },
      include: { qualificationType: true },
    });
    if (!record) throw new ApiError("NOT_FOUND", "资质记录不存在", 404);
    return jsonData(
      {
        ...deriveQualification(
          {
            id: record.qualificationType.code,
            name: record.qualificationType.name,
            expiresOn: record.expiryDate?.toISOString().slice(0, 10) ?? "",
            parameter: record.levelOrParameter,
            cycleMonths: undefined,
          },
          { now: () => new Date() },
        ),
        validityRule: parseValidityRule(record.qualificationType.validityRule),
        ruleVersion: record.qualificationType.version,
      },
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId);
  }
}
