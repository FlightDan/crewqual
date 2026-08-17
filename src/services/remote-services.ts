import type {
  AccessLinkReceipt,
  AdminEditableQualificationRecord,
  AdminQualificationRecordCreateInput,
  AdminDashboardSummary,
  AdminPilotDetail,
  AdminPilotListItem,
  AdminCalendarEvent,
  CalendarDayQualificationQuery,
  CalendarDayQualificationRoster,
  CalendarQuery,
  DocumentAssistState,
  DocumentIntelligenceService,
  EvidenceImageRef,
  EvidenceImageService,
  NotificationLog,
  NotificationQuery,
  NotificationSummary,
  PaginatedResult,
  PilotDirectoryQuery,
  PilotImportPreview,
  PilotImportResult,
  PilotImportMode,
  PilotManagementInput,
  PilotManagementMeta,
  PilotIdentityService,
  PilotProfile,
  Qualification,
  QualificationConfig,
  QualificationConfigInput,
  QualificationId,
  QualificationReview,
  QualificationSection,
  QualificationService,
  QualificationUpdateDraft,
  ReviewListQuery,
  ReviewService,
  ServiceResult,
  SubmissionReceipt,
  SubmissionService,
  UpgradePlanDraft,
  UpgradePlanQuery,
  UpgradePlanRecord,
  UpgradePlanService,
} from "@/types/services";
import type { ApplicationServices } from "@/services/application-services";

type ApiEnvelope<T> = { data: T; requestId?: string };

class RemoteApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const isMultipart = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const method = (init?.method ?? "GET").toUpperCase();
  const controller = init?.signal ? undefined : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), 15_000) : undefined;
  const csrfCookieName = path.startsWith("/api/admin/")
    ? "crewqual_admin_session_csrf"
    : "crewqual_pilot_session_csrf";
  const csrfToken =
    typeof document === "undefined"
      ? undefined
      : document.cookie
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${csrfCookieName}=`))
          ?.slice(csrfCookieName.length + 1);
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "include",
      ...init,
      ...(controller ? { signal: controller.signal } : {}),
      headers: {
        ...(isMultipart ? {} : { "content-type": "application/json" }),
        ...(csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method)
          ? { "x-csrf-token": decodeURIComponent(csrfToken) }
          : {}),
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  const body = (await response.json().catch(() => ({}))) as ApiEnvelope<T> & {
    error?: { code: string; message: string };
  };
  if (
    typeof window !== "undefined" &&
    process.env.NODE_ENV !== "test" &&
    path.startsWith("/api/admin/")
  ) {
    if (response.status === 401 && window.location.pathname !== "/admin/login") {
      const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
      window.location.replace(`/admin/login?reason=session-expired&next=${next}`);
    } else if (response.status === 403 && body.error?.code === "FORBIDDEN") {
      window.location.replace("/admin/forbidden");
    }
  }
  if (!response.ok || !("data" in body))
    throw new RemoteApiError(
      body.error?.code ?? "REMOTE_ERROR",
      body.error?.message ?? "请求失败",
      response.status,
    );
  return body.data;
}

function remote<T>(data: Promise<T>): Promise<ServiceResult<T>> {
  return data.then((value) => ({ data: value, source: "remote" as const }));
}

const noProfile: PilotProfile | null = null;

export const remotePilotIdentityService: PilotIdentityService = {
  requestAccessLink(input) {
    return remote(
      apiRequest<AccessLinkReceipt>("/api/pilot/access-link", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  },
  getActiveProfile() {
    return noProfile;
  },
  getProfile() {
    return remote(apiRequest<PilotProfile | null>("/api/pilot/session"));
  },
};

export const remoteEvidenceImageService: EvidenceImageService = {
  uploadProcessedJpeg(file) {
    const body = new FormData();
    body.append("file", file, "evidence.jpg");
    return remote(
      apiRequest<EvidenceImageRef>("/api/evidence-images", { method: "POST", body, headers: {} }),
    );
  },
  getSignedUrl(id) {
    return remote(apiRequest<{ url: string; expiresAt: string }>(`/api/evidence-images/${id}/url`));
  },
};

export const remoteQualificationService: QualificationService = {
  listForPilot() {
    return remote(apiRequest<QualificationSection[]>("/api/pilot/qualifications"));
  },
  getById(id: QualificationId) {
    return remote(
      apiRequest<Qualification | null>(`/api/pilot/qualifications/${encodeURIComponent(id)}`),
    );
  },
  listForPreview() {
    return remote(
      apiRequest<
        Array<{
          id: string;
          title: string;
          status: "valid" | "expiring" | "expired" | "review";
          expiresOn?: string;
        }>
      >("/api/pilot/qualifications"),
    );
  },
};

export const remoteDocumentIntelligenceService: DocumentIntelligenceService = {
  async recognizeDates(input) {
    if (typeof input !== "string") return { data: { kind: "skipped" }, source: "remote" };
    const task = await apiRequest<{ id: string; status: string }>(
      `/api/evidence-images/${input}/recognitions`,
      {
        method: "POST",
      },
    );
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const result = await apiRequest<{
        id: string;
        status: string;
        result?: {
          available?: boolean;
          confidence?: number;
          fields?: Record<string, string | null>;
          summary?: string;
        };
      }>(`/api/recognitions/${task.id}`);
      if (["queued", "running"].includes(result.status.toLowerCase())) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      const recognition = result.result;
      if (!recognition)
        return {
          data: { kind: "busy", operation: "recognize", retryable: true },
          source: "remote",
        };
      const issueDate = recognition.fields?.issueDate;
      const expiryDate = recognition.fields?.expiryDate;
      if (recognition.available && issueDate && expiryDate)
        return {
          data: {
            kind: "recognized",
            dates: { issueDate, expiryDate },
            confidence: {
              issueDate: recognition.confidence ?? 0,
              expiryDate: recognition.confidence ?? 0,
            },
          },
          source: "remote",
        };
      return {
        data: { kind: "busy", operation: "recognize", retryable: true },
        source: "remote",
      };
    }
    return {
      data: { kind: "busy", operation: "recognize", retryable: true },
      source: "remote",
    };
  },
  reviewDocument() {
    return Promise.resolve({
      data: { kind: "skipped" } as DocumentAssistState,
      source: "remote" as const,
    });
  },
  inspectForPreview() {
    return remote(apiRequest("/api/pilot/qualifications"));
  },
};

export const remoteSubmissionService: SubmissionService = {
  submitQualificationUpdate(draft: QualificationUpdateDraft) {
    return remote(
      apiRequest<SubmissionReceipt>("/api/pilot/submissions", {
        method: "POST",
        body: JSON.stringify({
          qualificationId: draft.qualificationId,
          evidenceId: draft.evidenceId,
          credentialNumber: draft.credentialNumber,
          issueDate: draft.issueDate,
          trainingDate: draft.trainingDate || null,
          expiryDate: draft.expiryDate || null,
          issuingAuthority: draft.issuingAuthority,
          levelOrParameter: draft.levelOrParameter,
        }),
      }),
    );
  },
  getReceipt() {
    return null;
  },
  getReceiptAsync(id) {
    return remote(apiRequest<SubmissionReceipt | null>(`/api/pilot/submissions/${id}`));
  },
};

function admin<T>(path: string, init?: RequestInit) {
  return remote(apiRequest<T>(path, init));
}

export const remoteAdminDashboardService: ApplicationServices["adminDashboard"] = {
  getSummary() {
    return admin<AdminDashboardSummary>("/api/admin/dashboard");
  },
};
export const remotePilotDirectoryService: ApplicationServices["pilotDirectory"] = {
  list(query: PilotDirectoryQuery) {
    return admin<PaginatedResult<AdminPilotListItem>>(
      `/api/admin/pilots?${new URLSearchParams(query as Record<string, string>).toString()}`,
    );
  },
  getById(id) {
    return admin<AdminPilotDetail | null>(`/api/admin/pilots/${id}`);
  },
  getManagementMeta() {
    return admin<PilotManagementMeta>("/api/admin/pilots/meta");
  },
  getCsvTemplate() {
    return admin<{ filename: string; content: string }>("/api/admin/pilots/import-template");
  },
  getCsvExport(unitId) {
    const query = unitId ? `?unitId=${encodeURIComponent(unitId)}` : "";
    return admin<{ filename: string; content: string }>(`/api/admin/pilots/export${query}`);
  },
  create(input: PilotManagementInput) {
    return admin<AdminPilotDetail>("/api/admin/pilots", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  update(id, input) {
    return admin<AdminPilotDetail>(`/api/admin/pilots/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  previewImport(csvText, mode: PilotImportMode = "create_only") {
    return admin<PilotImportPreview>("/api/admin/pilots/import-preview", {
      method: "POST",
      body: JSON.stringify({ csvText, mode }),
    });
  },
  importCsv(csvText, mode: PilotImportMode = "create_only", confirmMerge = false) {
    return admin<PilotImportResult>("/api/admin/pilots/import", {
      method: "POST",
      body: JSON.stringify({ csvText, mode, confirmMerge }),
    });
  },
  updateQualificationRecord(pilotId, qualificationId, input) {
    return admin<AdminEditableQualificationRecord>(
      `/api/admin/pilots/${encodeURIComponent(pilotId)}/qualifications/${encodeURIComponent(qualificationId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  },
  createQualificationRecord(pilotId, qualificationId, input: AdminQualificationRecordCreateInput) {
    return admin<AdminEditableQualificationRecord>(
      `/api/admin/pilots/${encodeURIComponent(pilotId)}/qualifications/${encodeURIComponent(qualificationId)}`,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
};

export const remoteReviewService: ReviewService = {
  list(query: ReviewListQuery) {
    return admin<PaginatedResult<QualificationReview>>(
      `/api/admin/reviews?${new URLSearchParams(query as Record<string, string>).toString()}`,
    );
  },
  getById(id) {
    return admin<QualificationReview | null>(`/api/admin/reviews/${id}`);
  },
  correct(id, input) {
    return admin<QualificationReview>(`/api/admin/reviews/${id}/correction`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  approve(id, input) {
    return admin<QualificationReview>(`/api/admin/reviews/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ ...input, confirmed: true }),
    });
  },
  returnForChanges(id, input) {
    return admin<QualificationReview>(`/api/admin/reviews/${id}/return`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async listForPreview() {
    const result = await admin<PaginatedResult<QualificationReview>>("/api/admin/reviews");
    return {
      data: result.data.items.map((item) => ({
        id: item.id,
        subject: item.pilotName,
        qualification: item.qualificationName,
        status:
          item.humanStatus === "pending"
            ? "pending"
            : item.aiStatus === "matched"
              ? "matched"
              : "needs-review",
      })),
      source: "remote" as const,
    };
  },
};

export const remoteCalendarService: ApplicationServices["calendar"] = {
  listEvents(query: CalendarQuery) {
    return admin<AdminCalendarEvent[]>(
      `/api/admin/calendar?${new URLSearchParams(query as Record<string, string>).toString()}`,
    );
  },
  getEvent(id) {
    return admin<AdminCalendarEvent | null>(`/api/admin/calendar/${id}`);
  },
  getDayQualificationRoster(query: CalendarDayQualificationQuery) {
    return admin<CalendarDayQualificationRoster>(
      `/api/admin/calendar/qualifications?${new URLSearchParams(query as Record<string, string>).toString()}`,
    );
  },
};

export const remoteUpgradePlanService: UpgradePlanService = {
  list(query: UpgradePlanQuery) {
    return admin<PaginatedResult<UpgradePlanRecord>>(
      `/api/admin/upgrade-plans?${new URLSearchParams(query as Record<string, string>).toString()}`,
    );
  },
  getById(id) {
    return admin<UpgradePlanRecord | null>(`/api/admin/upgrade-plans/${id}`);
  },
  listInspectionItems() {
    return admin("/api/admin/upgrade-plans/inspection-items");
  },
  saveDraft(input: UpgradePlanDraft) {
    return admin<UpgradePlanRecord>("/api/admin/upgrade-plans", {
      method: "POST",
      body: JSON.stringify({ ...input, action: "save" }),
    });
  },
  createAndStart(input) {
    return admin<UpgradePlanRecord>("/api/admin/upgrade-plans", {
      method: "POST",
      body: JSON.stringify({ ...input, action: "start" }),
    });
  },
  update(id, input) {
    return admin<UpgradePlanRecord>(`/api/admin/upgrade-plans/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  rescheduleStage(planId, stageId, input) {
    return admin<UpgradePlanRecord>(
      `/api/admin/upgrade-plans/${planId}/stages/${stageId}/reschedule`,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  completeStage(planId, stageId, input) {
    return admin<UpgradePlanRecord>(
      `/api/admin/upgrade-plans/${planId}/stages/${stageId}/complete`,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  start(id, expectedVersion) {
    return admin<UpgradePlanRecord>(`/api/admin/upgrade-plans/${id}/start`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    });
  },
  pause(id, expectedVersion) {
    return admin<UpgradePlanRecord>(`/api/admin/upgrade-plans/${id}/pause`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    });
  },
  resume(id, expectedVersion) {
    return admin<UpgradePlanRecord>(`/api/admin/upgrade-plans/${id}/resume`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    });
  },
  cancel(id, input) {
    return admin<UpgradePlanRecord>(`/api/admin/upgrade-plans/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};

export const remoteQualificationConfigService: ApplicationServices["qualificationConfigs"] = {
  list() {
    return admin<QualificationConfig[]>("/api/admin/qualification-configs");
  },
  getById(id) {
    return admin<QualificationConfig | null>(`/api/admin/qualification-configs/${id}`);
  },
  save(id, input: QualificationConfigInput & { expectedVersion?: number }) {
    return admin<QualificationConfig>(
      `/api/admin/qualification-configs?id=${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  },
  createSupplemental(input) {
    return admin<QualificationConfig>("/api/admin/qualification-configs", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};

export const remoteNotificationService: ApplicationServices["notifications"] = {
  getSummary() {
    return admin<NotificationSummary>("/api/admin/notifications/summary");
  },
  list(query: NotificationQuery) {
    return admin<PaginatedResult<NotificationLog>>(
      `/api/admin/notifications?${new URLSearchParams(query as Record<string, string>).toString()}`,
    );
  },
  getById(id) {
    return admin<NotificationLog | null>(`/api/admin/notifications/${id}`);
  },
  retry(id, expectedVersion) {
    return admin<NotificationLog>(`/api/admin/notifications/${id}/retry`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    });
  },
  async listForPreview() {
    const result = await admin<{ items: NotificationLog[] }>("/api/admin/notifications");
    return {
      data: result.data.items.map((item) => ({
        id: item.id,
        title: item.summary,
        body: item.message,
        channel: item.channel === "in_app" ? "in-app" : "placeholder",
      })),
      source: "remote" as const,
    };
  },
};
