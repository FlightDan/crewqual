import { describe, expect, it } from "vitest";
import {
  applyRecognizedDates,
  createEmptyDraft,
  identitySchema,
  isDraftSubmittable,
  qualificationUpdateSchema,
  sourceAfterDateChange,
} from "@/lib/pilot-validation";

describe("pilot validation and date rules", () => {
  it("validates employee number and 11 digit mobile", () => {
    expect(identitySchema.safeParse({ employeeNumber: "", mobile: "13800138000" }).success).toBe(
      false,
    );
    expect(
      identitySchema.safeParse({ employeeNumber: "CQ-1049", mobile: "1380013800" }).success,
    ).toBe(false);
    expect(
      identitySchema.safeParse({ employeeNumber: "CQ-1049", mobile: "13800138000" }).success,
    ).toBe(true);
  });

  it("rejects invalid dates and expiry before issue", () => {
    const values = {
      credentialNumber: "MOCK-01",
      issueDate: "2026-10-09",
      trainingDate: "",
      expiryDate: "2026-01-09",
      issuingAuthority: "示例签发机构",
      levelOrParameter: "A320",
    };
    const result = qualificationUpdateSchema.safeParse(values);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("到期日期不得早于签发日期");
    expect(
      qualificationUpdateSchema.safeParse({ ...values, issueDate: "2026-13-40" }).success,
    ).toBe(false);
  });

  it("starts empty and requires a document plus all valid fields", () => {
    const draft = createEmptyDraft("medical-certificate");
    expect(draft).toMatchObject({
      documentName: "",
      credentialNumber: "",
      issueDate: "",
      expiryDate: "",
      issuingAuthority: "",
      levelOrParameter: "",
    });
    expect(isDraftSubmittable(draft)).toBe(false);
    expect(
      isDraftSubmittable({
        ...draft,
        documentName: "credential.jpg",
        documentType: "image/jpeg",
        credentialNumber: "MOCK-01",
        issueDate: "2026-01-09",
        expiryDate: "2026-10-09",
        issuingAuthority: "示例签发机构",
        levelOrParameter: "合格",
      }),
    ).toBe(true);
  });

  it("enforces configured level/parameter restrictions in draft validation", () => {
    const draft = {
      ...createEmptyDraft("simulator-recurrent-training"),
      documentName: "credential.jpg",
      credentialNumber: "MOCK-01",
      issueDate: "2026-01-09",
      expiryDate: "2026-10-09",
      issuingAuthority: "示例签发机构",
      levelOrParameter: "B737",
    };
    const restriction = {
      enabled: true,
      description: "A320 系列",
      version: 1 as const,
      enforcement: { mode: "regex" as const, allowedValues: [], pattern: "^A320-(I|II)$" },
    };

    expect(isDraftSubmittable(draft, { kind: "manual_expiry" }, restriction)).toBe(false);
    expect(
      isDraftSubmittable(
        { ...draft, levelOrParameter: "A320-II" },
        { kind: "manual_expiry" },
        restriction,
      ),
    ).toBe(true);
  });

  it("AI fills only blank dates and never overwrites manual values", () => {
    const draft = {
      ...createEmptyDraft("medical-certificate"),
      issueDate: "2026-02-01",
      dateSources: { issueDate: "manual" as const },
    };
    const next = applyRecognizedDates(draft, { issueDate: "2026-01-09", expiryDate: "2026-10-09" });
    expect(next.issueDate).toBe("2026-02-01");
    expect(next.dateSources.issueDate).toBe("manual");
    expect(next.expiryDate).toBe("2026-10-09");
    expect(next.dateSources.expiryDate).toBe("ai");
  });

  it("marks an edited AI date as manually modified", () => {
    expect(sourceAfterDateChange("2026-10-09", "2026-10-10", "ai")).toBe("manual_modified");
    expect(sourceAfterDateChange("", "2026-10-10", undefined)).toBe("manual");
  });
});
