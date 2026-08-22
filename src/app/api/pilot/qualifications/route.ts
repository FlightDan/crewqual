import { NextRequest } from "next/server";
import { getRequestId, jsonData, jsonError } from "@/server/api";
import { authenticatePilot } from "@/server/auth";
import { deriveQualificationDateState } from "@/lib/qualification-date-status";
import { getPrisma } from "@/server/prisma";
import { parseValidityRule } from "@/lib/qualification-rules";

function toDate(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? "";
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const pilot = await authenticatePilot(request);
    const records = await getPrisma().qualificationRecord.findMany({
      where: { pilotId: pilot.id, status: "ACTIVE" },
      include: { qualificationType: true },
      orderBy: { qualificationType: { name: "asc" } },
    });
    const sections = records.reduce<Record<string, Array<Record<string, unknown>>>>(
      (groups, record) => {
        const expiresOn = toDate(record.expiryDate);
        const state = deriveQualificationDateState(expiresOn);
        const item = {
          id: record.qualificationType.code,
          name: record.qualificationType.name,
          translations: record.qualificationType.translations,
          expiresOn,
          status: state.status,
          statusLabel: state.statusLabel,
          remainingLabel: state.remainingLabel,
          parameter: record.levelOrParameter,
          validityRule: parseValidityRule(record.qualificationType.validityRule),
          ruleVersion: record.qualificationType.version,
        };
        (groups[state.status] ??= []).push(item);
        return groups;
      },
      {},
    );
    const sectionTitles: Record<string, string> = {
      expired: "需要紧急处理（已过期）",
      due_30: "即将到期（30天内）",
      due_90: "正常跟进（90天内）",
      valid: "正常运行中",
    };
    return jsonData(
      ["expired", "due_30", "due_90", "valid"].map((status) => ({
        status,
        title: sectionTitles[status],
        qualifications: sections[status] ?? [],
      })),
      requestId,
    );
  } catch (error) {
    return jsonError(error, requestId);
  }
}
