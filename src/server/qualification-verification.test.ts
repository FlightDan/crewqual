import { describe, expect, it, vi } from "vitest";
import {
  determineVerification,
  persistVerificationForEvidence,
} from "@/server/qualification-verification";

function request() {
  return {
    id: "request-1",
    credentialNumber: "CERT-001",
    expiryDate: new Date("2027-01-31T00:00:00Z"),
    issuingAuthority: "CAAC",
    pilot: { displayName: "张三" },
    qualificationRuleSnapshot: {
      version: 1,
      validityRule: { kind: "manual_expiry" },
      reminders: { firstDays: 90, secondDays: 30 },
      parameterRestriction: { enabled: false, description: "" },
      ocrChecks: {
        enabled: true,
        credentialNumber: true,
        holderMatch: true,
        expiryDate: true,
        issuingAuthoritySeal: false,
      },
    },
  };
}

const matchingExtraction = {
  available: true,
  provider: "fake-vlm",
  confidence: 0.95,
  summary: "字段提取完成",
  fields: {
    credentialNumber: "CERT-001",
    holderName: "张三",
    expiryDate: "2027-01-31",
  },
  fieldConfidence: { credentialNumber: 0.98, holderName: 0.95, expiryDate: 0.96 },
  evidence: { credentialNumber: "证号区域", holderName: "持有人区域", expiryDate: "日期区域" },
};

describe("server-side OCR business verification", () => {
  it("ignores a model-provided matched claim and detects a credential mismatch", () => {
    const result = determineVerification(request(), {
      ...matchingExtraction,
      status: "matched",
      fields: { ...matchingExtraction.fields, credentialNumber: "WRONG-CERT" },
    });
    expect(result.status).toBe("MISMATCH");
    expect(result.result).toMatchObject({
      decidedBy: "server",
      checks: { credentialNumber: { status: "FAIL", extracted: "WRONG-CERT" } },
    });
  });

  it("persists one replay-safe verification result per request", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "verification-1" });
    const tx = {
      qualificationEvidence: {
        findMany: vi.fn().mockResolvedValue([{ updateRequest: request() }]),
      },
      verificationResult: { upsert },
    };

    await persistVerificationForEvidence(tx, "image-1", matchingExtraction);
    await persistVerificationForEvidence(tx, "image-1", matchingExtraction);

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { requestId: "request-1" },
        update: expect.objectContaining({ status: "MATCHED" }),
      }),
    );
  });

  it("fails closed when one image is linked to multiple update requests", async () => {
    const tx = {
      qualificationEvidence: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { updateRequest: request() },
            { updateRequest: { ...request(), id: "request-2" } },
          ]),
      },
      verificationResult: { upsert: vi.fn() },
    };

    await expect(persistVerificationForEvidence(tx, "image-1", matchingExtraction)).rejects.toThrow(
      "linked to multiple qualification update requests",
    );
    expect(tx.verificationResult.upsert).not.toHaveBeenCalled();
  });
});
