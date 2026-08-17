import type {
  DateCandidate,
  Clock,
  DocumentAssistState,
  DocumentIntelligenceService,
  NotificationMessage,
  ServiceResult,
  PilotIdentityService,
  PilotFlowScenario,
  QualificationId,
  QualificationService,
  SubmissionReceipt,
  SubmissionService,
} from "@/types/services";
import { pilotProfileFixture, pilotQualificationFixtures } from "@/mocks/fixtures";
import {
  deriveQualification,
  deriveQualificationDateState,
  groupQualificationsByStatus,
  systemClock,
} from "@/lib/qualification-date-status";
import { pilotProfileRepository, submissionReceiptRepository } from "@/services/session-repository";

const mockDelay = (milliseconds = 180) =>
  new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));

const recognizedDates = {
  issueDate: "2026-01-09",
  expiryDate: "2026-10-09",
} as const;

const expiryCandidates: DateCandidate[] = [
  {
    id: "candidate-expiry",
    field: "expiryDate",
    value: "2026-10-09",
    confidence: 0.94,
    description: "可能为到期日期（第2段文字）",
  },
  {
    id: "candidate-supplement",
    field: "expiryDate",
    value: "2026-09-09",
    confidence: 0.82,
    description: "可能为签发补充日期（第1段文字）",
  },
  {
    id: "candidate-renewal",
    field: "expiryDate",
    value: "2027-01-09",
    confidence: 0.78,
    description: "可能为续期日期（第3段文字）",
  },
];

export const mockPilotIdentityService: PilotIdentityService = {
  async requestAccessLink() {
    await mockDelay();
    pilotProfileRepository.set("active", pilotProfileFixture);
    return { data: { accepted: true }, source: "mock" };
  },
  getActiveProfile() {
    return pilotProfileRepository.get("active");
  },
  async getProfile() {
    await mockDelay(30);
    return { data: pilotProfileRepository.get("active"), source: "mock" };
  },
};

export function createMockQualificationService(clock: Clock = systemClock): QualificationService {
  return {
    async listForPilot() {
      return {
        data: groupQualificationsByStatus(pilotQualificationFixtures, clock),
        source: "mock",
      };
    },
    async getById(id: QualificationId) {
      const record = pilotQualificationFixtures.find((qualification) => qualification.id === id);
      return { data: record ? deriveQualification(record, clock) : null, source: "mock" };
    },
    async listForPreview() {
      return {
        data: pilotQualificationFixtures.map((item) => {
          const state = deriveQualificationDateState(item.expiresOn, clock);
          return {
            id: item.id,
            title: item.name,
            status:
              state.status === "expired"
                ? "expired"
                : state.status === "valid"
                  ? "valid"
                  : "expiring",
            expiresOn: item.expiresOn,
          };
        }),
        source: "mock",
      };
    },
  };
}

export const mockQualificationService = createMockQualificationService();

function recognitionResult(scenario: PilotFlowScenario): DocumentAssistState {
  switch (scenario) {
    case "ambiguous":
      return { kind: "ambiguous", field: "expiryDate", candidates: expiryCandidates };
    case "busy":
      return { kind: "busy", operation: "recognize", retryable: true };
    case "conflict":
      return {
        kind: "conflict",
        field: "expiryDate",
        manualValue: "2026-10-09",
        aiCandidate: {
          id: "candidate-conflict",
          field: "expiryDate",
          value: "2026-09-09",
          confidence: 0.92,
          description: "AI识别的到期日期",
        },
      };
    default:
      return {
        kind: "recognized",
        dates: recognizedDates,
        confidence: { issueDate: 0.98, expiryDate: 0.96 },
      };
  }
}

export const mockDocumentIntelligenceService: DocumentIntelligenceService = {
  async recognizeDates(_file, scenario = "default") {
    if (scenario === "recognizing" || scenario === "confirm") {
      return new Promise(() => undefined);
    }
    await mockDelay(420);
    return { data: recognitionResult(scenario), source: "mock" };
  },
  async reviewDocument(draft, scenario = "default") {
    await mockDelay(360);
    if (scenario === "busy") {
      return { data: { kind: "busy", operation: "review", retryable: true }, source: "mock" };
    }
    if (scenario === "mismatch") {
      return {
        data: {
          kind: "mismatch",
          message: "到期日期与凭证信息可能存在差异",
          documentValue: "2026-09-09",
          formValue: draft.expiryDate,
        },
        source: "mock",
      };
    }
    return { data: { kind: "matched" }, source: "mock" };
  },
  async inspectForPreview() {
    return {
      data: { confidence: 0.96, fields: { title: "示例资质" }, warnings: [] },
      source: "mock",
    };
  },
};

export const mockSubmissionService: SubmissionService = {
  async submitQualificationUpdate(draft) {
    await mockDelay();
    const qualification = pilotQualificationFixtures.find(
      (item) => item.id === draft.qualificationId,
    );
    const id = `SUB-${Date.now().toString(36).toUpperCase()}`;
    const receipt: SubmissionReceipt = {
      id,
      qualificationId: draft.qualificationId,
      qualificationName: qualification?.name ?? "资质更新",
      submittedAt: new Date().toISOString(),
      status: "received",
      notifications: ["system", "feishu", "sms"],
    };
    submissionReceiptRepository.set(id, receipt);
    return { data: receipt, source: "mock" };
  },
  getReceipt(id) {
    return submissionReceiptRepository.get(id);
  },
};

export const mockNotificationService: {
  listForPreview(): Promise<ServiceResult<NotificationMessage[]>>;
} = {
  async listForPreview() {
    return {
      data: [
        {
          id: "mock-notification-01",
          title: "示例通知",
          body: "这是一条仅用于 UI 验收的通知。",
          channel: "in-app",
        },
      ],
      source: "mock",
    };
  },
};
