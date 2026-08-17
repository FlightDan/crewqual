import { parseQualificationRuleSnapshot } from "@/lib/qualification-rules";
import { extractionResultSchema, type VlmRecognition } from "@/server/vlm";

/* eslint-disable @typescript-eslint/no-explicit-any */

type CheckStatus = "PASS" | "FAIL" | "UNCERTAIN" | "SKIPPED";
type CheckResult = {
  status: CheckStatus;
  expected?: string;
  extracted?: string;
  confidence?: number;
  evidence?: string;
  reason: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value: string) {
  return value.replace(/\s+/g, "").toLocaleLowerCase();
}

function compareField(key: string, expected: string, extraction: VlmRecognition): CheckResult {
  const extracted = text(extraction.fields[key]);
  const confidence = extraction.fieldConfidence[key] ?? extraction.confidence;
  const evidence = extraction.evidence[key];
  if (!extracted) {
    return { status: "UNCERTAIN", expected, confidence, evidence, reason: "模型未提取到该字段" };
  }
  const pass = normalized(extracted) === normalized(expected);
  return {
    status: pass ? "PASS" : "FAIL",
    expected,
    extracted,
    confidence,
    evidence,
    reason: pass ? "提取值与提交值一致" : "提取值与提交值不一致",
  };
}

export function determineVerification(
  request: {
    credentialNumber: string;
    expiryDate: Date | null;
    issuingAuthority: string;
    qualificationRuleSnapshot: unknown;
    pilot: { displayName: string };
  },
  rawExtraction: unknown,
) {
  const extraction = extractionResultSchema.parse(rawExtraction);
  const snapshot = parseQualificationRuleSnapshot(request.qualificationRuleSnapshot);
  if (!extraction.available) {
    return {
      status: "UNAVAILABLE" as const,
      result: {
        summary: extraction.summary,
        extraction,
        checks: {},
        decidedBy: "server",
      },
      provider: extraction.provider,
    };
  }
  if (!snapshot.ocrChecks.enabled) {
    return {
      status: "UNAVAILABLE" as const,
      result: {
        summary: "该资质未启用 OCR 业务核验",
        extraction,
        checks: {},
        decidedBy: "server",
      },
      provider: extraction.provider,
    };
  }

  const checks: Record<string, CheckResult> = {};
  if (snapshot.ocrChecks.credentialNumber) {
    checks.credentialNumber = compareField(
      "credentialNumber",
      request.credentialNumber,
      extraction,
    );
  }
  if (snapshot.ocrChecks.holderMatch) {
    checks.holderMatch = compareField("holderName", request.pilot.displayName, extraction);
  }
  if (snapshot.ocrChecks.expiryDate) {
    checks.expiryDate = compareField(
      "expiryDate",
      request.expiryDate?.toISOString().slice(0, 10) ?? "",
      extraction,
    );
  }
  if (snapshot.ocrChecks.issuingAuthoritySeal) {
    const authority = compareField("issuingAuthority", request.issuingAuthority, extraction);
    const sealDetected = normalized(text(extraction.fields.sealDetected));
    checks.issuingAuthoritySeal =
      authority.status !== "PASS"
        ? authority
        : sealDetected === "true" || sealDetected === "是" || sealDetected === "有"
          ? { ...authority, status: "PASS", reason: "签发机构一致且检测到印章" }
          : {
              ...authority,
              status: sealDetected ? "FAIL" : "UNCERTAIN",
              reason: sealDetected ? "未检测到签发印章" : "无法确定是否存在签发印章",
            };
  }

  const values = Object.values(checks);
  const status = values.some((check) => check.status === "FAIL")
    ? "MISMATCH"
    : values.some((check) => check.status === "UNCERTAIN") || !values.length
      ? "UNCERTAIN"
      : "MATCHED";
  return {
    status,
    result: {
      summary:
        status === "MATCHED"
          ? "服务端逐项核验一致，仍需人工审批"
          : status === "MISMATCH"
            ? "服务端发现字段不一致，需人工复核"
            : "提取结果不足以完成自动比对，需人工复核",
      extraction,
      checks,
      decidedBy: "server",
    },
    provider: extraction.provider,
  };
}

export async function persistVerificationForEvidence(
  tx: any,
  evidenceImageId: string,
  extraction: unknown,
) {
  const relation = await tx.qualificationEvidence.findUnique({
    where: { evidenceImageId: evidenceImageId },
    select: {
      updateRequest: {
        include: { pilot: true },
      },
    },
  });
  const request = relation?.updateRequest;
  if (!request) return null;
  const verification = determineVerification(request, extraction);
  return tx.verificationResult.upsert({
    where: { requestId: request.id },
    update: verification,
    create: { requestId: request.id, ...verification },
  });
}
