import { describe, expect, it } from "vitest";
import { pilotQualificationFixtures } from "@/mocks/fixtures";
import { CORE_QUALIFICATION_CATALOG } from "@/types/services";
import {
  createMockQualificationService,
  mockDocumentIntelligenceService,
  mockSubmissionService,
} from "@/services/mock-services";
import { createEmptyDraft } from "@/lib/pilot-validation";

describe("pilot mock services", () => {
  it("provides all six official qualification names in the right groups", async () => {
    expect(pilotQualificationFixtures.map((item) => item.name)).toEqual(
      CORE_QUALIFICATION_CATALOG.map((item) => item.name),
    );
    const service = createMockQualificationService({ now: () => new Date("2026-08-14T08:00:00Z") });
    const sections = (await service.listForPilot("pilot-mock-01")).data;
    expect(sections.map((section) => section.status)).toEqual([
      "missing",
      "incomplete",
      "expired",
      "due_30",
      "due_90",
      "valid",
    ]);
    const simulator = sections
      .flatMap((section) => section.qualifications)
      .find((item) => item.id === "simulator-recurrent-training");
    expect(simulator).toMatchObject({
      cycleMonths: 6,
      parameter: "A320",
      expiresOn: "2026-12-10",
      status: "valid",
    });
    expect(simulator?.remainingLabel).toBe("剩余 118 天");
  });

  it("returns deterministic ambiguity, conflict, mismatch and busy states", async () => {
    const file = { name: "credential.jpg", type: "image/jpeg", size: 1024 };
    await expect(
      mockDocumentIntelligenceService.recognizeDates(file, "ambiguous"),
    ).resolves.toMatchObject({ data: { kind: "ambiguous" } });
    await expect(
      mockDocumentIntelligenceService.recognizeDates(file, "conflict"),
    ).resolves.toMatchObject({ data: { kind: "conflict" } });
    await expect(
      mockDocumentIntelligenceService.recognizeDates(file, "busy"),
    ).resolves.toMatchObject({ data: { kind: "busy" } });
    const draft = { ...createEmptyDraft("medical-certificate"), expiryDate: "2026-10-09" };
    await expect(
      mockDocumentIntelligenceService.reviewDocument(draft, "mismatch"),
    ).resolves.toMatchObject({ data: { kind: "mismatch" } });
  });

  it("creates and stores a mock submission receipt", async () => {
    const draft = {
      ...createEmptyDraft("medical-certificate"),
      documentName: "credential.jpg",
      documentType: "image/jpeg",
      credentialNumber: "MOCK-01",
      issueDate: "2026-01-09",
      expiryDate: "2026-10-09",
      issuingAuthority: "示例签发机构",
      levelOrParameter: "合格",
    };
    const result = await mockSubmissionService.submitQualificationUpdate(draft);
    expect(result.data).toMatchObject({
      status: "received",
      notifications: ["system", "feishu", "sms"],
    });
    expect(mockSubmissionService.getReceipt(result.data.id)).toEqual(result.data);
  });

  it("enforces the same parameter restriction before creating a mock receipt", async () => {
    const draft = {
      ...createEmptyDraft("simulator-recurrent-training"),
      documentName: "credential.jpg",
      documentType: "image/jpeg",
      credentialNumber: "MOCK-02",
      issueDate: "2026-01-09",
      expiryDate: "2026-10-09",
      issuingAuthority: "示例签发机构",
      levelOrParameter: "B737",
    };

    await expect(mockSubmissionService.submitQualificationUpdate(draft)).rejects.toThrow(
      "等级/参数必须是：A320",
    );
  });
});
