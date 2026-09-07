import type { PilotRoleCode, UpgradeStageCode } from "@/lib/domain-i18n";

export type ServiceSource = "mock" | "remote" | "local-cache";
export type ServiceResult<T> = { data: T; source: ServiceSource };

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export type PilotProfile = {
  id: string;
  employeeNumber: string;
  displayName: string;
  initials: string;
  role: string;
  unit: string;
};

export type QualificationId = string;
export const CORE_QUALIFICATION_CATALOG = [
  {
    id: "medical-certificate",
    name: "民用航空人员体检合格证",
    translations: {
      "zh-CN": "民用航空人员体检合格证",
      "en-US": "Civil Aviation Personnel Medical Certificate",
    },
    code: "QUAL-MC-01",
    parameter: "IA级（无限制）",
    cycleMonths: undefined,
  },
  {
    id: "annual-recurrent-training",
    name: "机组年度复训合格证",
    translations: {
      "zh-CN": "机组年度复训合格证",
      "en-US": "Annual Recurrent Training Certificate",
    },
    code: "QUAL-TY-320",
    parameter: "合格",
    cycleMonths: 12,
  },
  {
    id: "dangerous-goods-training",
    name: "危险品运输培训合格证",
    translations: {
      "zh-CN": "危险品运输培训合格证",
      "en-US": "Dangerous Goods Transportation Training Certificate",
    },
    code: "QUAL-DG-05",
    parameter: "合格（两年期）",
    cycleMonths: undefined,
  },
  {
    id: "icao-english-endorsement",
    name: "ICAO英语语言能力等级签注",
    translations: {
      "zh-CN": "ICAO英语语言能力等级签注",
      "en-US": "ICAO English Language Proficiency Endorsement",
    },
    code: "QUAL-EN-04",
    parameter: "ICAO 4级",
    cycleMonths: undefined,
  },
  {
    id: "chinese-language-assessment",
    name: "ICAO汉语语言能力等级签注",
    translations: {
      "zh-CN": "ICAO汉语语言能力等级签注",
      "en-US": "ICAO Chinese Language Proficiency Endorsement",
    },
    code: "QUAL-EM-02",
    parameter: "四级标准",
    cycleMonths: undefined,
  },
  {
    id: "simulator-recurrent-training",
    name: "模拟机复训（每6个月）",
    translations: {
      "zh-CN": "模拟机复训（每6个月）",
      "en-US": "Simulator Recurrent Training (Every 6 Months)",
    },
    code: "QUAL-PC-12",
    parameter: "A320",
    cycleMonths: 6,
  },
] as const satisfies ReadonlyArray<{
  id: QualificationId;
  name: string;
  translations?: Record<string, string>;
  code: string;
  parameter: string;
  cycleMonths?: number;
}>;

export const CORE_QUALIFICATION_IDS = CORE_QUALIFICATION_CATALOG.map((item) => item.id);

export type QualificationStatus =
  "missing" | "incomplete" | "expired" | "due_30" | "due_90" | "valid";
export type QualificationExpiryWindow = QualificationStatus | "due_7";

export type QualificationDateState = {
  status: QualificationStatus;
  window: QualificationExpiryWindow;
  daysRemaining: number | null;
  statusLabel: string;
  remainingLabel: string;
  statusReason?: string;
};

export type QualificationParameterRestriction = {
  enabled: boolean;
  description: string;
  version?: 1;
  enforcement?: {
    mode: "none" | "allowed_values" | "regex";
    allowedValues?: string[];
    pattern?: string;
  };
};

export type QualificationSection = {
  status: QualificationStatus;
  title: string;
  qualifications: Qualification[];
};

export type Qualification = {
  id: QualificationId;
  name: string;
  translations?: Record<string, string>;
  status: QualificationStatus;
  expiresOn: string;
  statusLabel: string;
  remainingLabel: string;
  parameter?: string;
  cycleMonths?: number;
  validityRule?: ValidityRule;
  parameterRestriction?: QualificationParameterRestriction;
  ruleVersion?: number;
  /** The holder's business timezone, never the viewer's browser timezone. */
  timezone?: string | null;
  required?: boolean;
  recordExists?: boolean;
  statusReason?: string;
  submissionSupported?: boolean;
};

export type QualificationRecord = Omit<Qualification, "status" | "statusLabel" | "remainingLabel">;

export type DateFieldSource = "manual" | "ai" | "manual_modified";
export type DateFieldName = "issueDate" | "trainingDate" | "expiryDate";

export type DateCandidate = {
  id: string;
  field: DateFieldName;
  value: string;
  confidence: number;
  description: string;
};

export type QualificationUpdateDraft = {
  qualificationId: QualificationId;
  evidenceId: string;
  /** @deprecated Only retained for the Mock adapter and old UI fixture compatibility. */
  documentName: string;
  /** @deprecated Only retained for the Mock adapter and old UI fixture compatibility. */
  documentType: string;
  /** @deprecated Only retained for the Mock adapter and old UI fixture compatibility. */
  documentSize: number;
  /** @deprecated Never populated in remote mode; use evidenceId and a signed URL. */
  documentPreviewUrl: string;
  credentialNumber: string;
  issueDate: string;
  trainingDate?: string;
  expiryDate: string;
  issuingAuthority: string;
  levelOrParameter: string;
  dateSources: Partial<Record<DateFieldName, DateFieldSource>>;
};

export type DocumentAssistState =
  | { kind: "idle" }
  | { kind: "recognizing" }
  | {
      kind: "recognized";
      dates: Partial<Record<DateFieldName, string>>;
      confidence: Partial<Record<DateFieldName, number>>;
    }
  | { kind: "ambiguous"; field: DateFieldName; candidates: DateCandidate[] }
  | {
      kind: "conflict";
      field: DateFieldName;
      manualValue: string;
      aiCandidate: DateCandidate;
    }
  | { kind: "reviewing" }
  | { kind: "matched" }
  | { kind: "mismatch"; message: string; documentValue: string; formValue: string }
  | { kind: "busy"; operation: "recognize" | "review"; retryable: boolean }
  | { kind: "skipped" };

export type PilotFlowScenario =
  | "default"
  | "recognizing"
  | "recognized"
  | "ambiguous"
  | "conflict"
  | "mismatch"
  | "busy"
  | "modified"
  | "confirm";

export type SubmissionStatus = "received" | "processing" | "approved" | "returned";

export type SubmissionReceipt = {
  id: string;
  qualificationId: QualificationId;
  qualificationName: string;
  qualificationTranslations?: Record<string, string>;
  submittedAt: string;
  status: SubmissionStatus;
  notifications: Array<"system" | "feishu" | "sms">;
  decisionNote?: string;
  returnReason?: string;
};

export type ReviewId = string;
export type ReviewHumanStatus = "pending" | "approved" | "returned";
export type ReviewAiStatus = "matched" | "question" | "mismatch" | "unavailable";
export type ReviewCredentialFieldName =
  | "credentialNumber"
  | "issueDate"
  | "trainingDate"
  | "expiryDate"
  | "issuingAuthority"
  | "levelOrParameter";

export type ReviewCredentialFields = Record<
  Exclude<ReviewCredentialFieldName, "trainingDate">,
  string
> & { trainingDate?: string };

export type ReviewFieldComparison = {
  field: ReviewCredentialFieldName;
  label: string;
  submittedValue: string;
  source: DateFieldSource | "user_manual";
  aiOriginalValue?: string;
  confidence?: number;
  correctedValue?: string;
};

export type ReviewCorrectionPatch = Partial<ReviewCredentialFields>;
export type ReviewCorrectionInput = ReviewCredentialFields;

export type ReviewDecision =
  { kind: "approved"; note?: string; confirmed: true } | { kind: "returned"; reason: string };

export type ReviewAuditEvent = {
  id: string;
  action: string;
  actor: string;
  occurredAt: string;
  detail: string;
};

export type ReviewAiComparison = {
  label: string;
  result: string;
  status: ReviewAiStatus;
  confidence?: number;
};

export type EffectiveQualificationRecord = ReviewCredentialFields & {
  qualificationId: QualificationId;
  effectiveFrom: string;
  status: "active" | "replaced";
};

export type QualificationReview = {
  id: ReviewId;
  pilotId: string;
  pilotName: string;
  employeeNumber: string;
  role: string;
  qualificationId: QualificationId;
  qualificationName: string;
  qualificationTranslations?: Record<string, string>;
  validityRule?: ValidityRule;
  parameterRestriction?: QualificationParameterRestriction;
  ruleVersion?: number;
  submittedAt: string;
  humanStatus: ReviewHumanStatus;
  aiStatus: ReviewAiStatus;
  aiConclusion: string;
  aiConfidence?: number;
  aiReviewedAt?: string;
  documentName: string;
  documentKind: "sanitized-sample";
  documentUrl?: string;
  evidenceImageId?: string;
  submittedFields: ReviewCredentialFields;
  fieldComparisons: ReviewFieldComparison[];
  aiComparisons: ReviewAiComparison[];
  currentRecord: EffectiveQualificationRecord | null;
  corrections: ReviewCorrectionPatch;
  audit: ReviewAuditEvent[];
  version?: number;
  decision?: ReviewDecision & { actor: string; occurredAt: string };
};

export const UPGRADE_STAGE_NAMES = [
  "理论口试",
  "中队评估",
  "大队评估",
  "模拟机检查",
  "航线检查",
  "实践考试",
] as const;

export { UPGRADE_STAGE_CODES } from "@/lib/domain-i18n";
export type { PilotRoleCode, UpgradeStageCode } from "@/lib/domain-i18n";
export type UpgradeStageName = (typeof UPGRADE_STAGE_NAMES)[number];
export type UpgradeStageStatus =
  "completed" | "in_progress" | "delayed" | "scheduled" | "not_started";

export type UpgradePlanId = string;
export type UpgradePlanType =
  | "captain_upgrade"
  | "level_upgrade"
  | "qualification_recovery"
  | "instructor_upgrade"
  | "type_rating";
export type UpgradePlanLifecycleStatus =
  "draft" | "not_started" | "active" | "paused" | "completed" | "cancelled";

export type UpgradePlanStageRecord = {
  id: string;
  code: UpgradeStageCode;
  name: string;
  status: UpgradeStageStatus;
  plannedStart: string;
  plannedEnd: string;
  owner: string;
  notes: string;
  completedOn?: string;
  resultSummary?: string;
  delayDays?: number;
  inspectionItems?: UpgradePlanInspectionItem[];
};

export type InspectionItem = {
  id: string;
  code: string;
  name: string;
  description: string;
  ruleVersion: number;
};

export type UpgradePlanInspectionItem = {
  id: string;
  inspectionItemId: string;
  stageId: string;
  stageOrder: number;
  name: string;
  ruleVersion: number;
  status: "pending" | "completed";
  completedOn?: string;
  resultSummary?: string;
};

export type UpgradePlanInspectionSelection = {
  inspectionItemId: string;
  stageOrder: number;
};

export type UpgradePlanRecord = {
  id: UpgradePlanId;
  planNumber: string;
  pilotId: string;
  positionCode?: string;
  positionName?: string;
  title: string;
  type: UpgradePlanType;
  lifecycleStatus: UpgradePlanLifecycleStatus;
  startDate: string;
  endDate: string;
  overallOwner: string;
  leadDepartment: string;
  stages: UpgradePlanStageRecord[];
  inspectionItems: UpgradePlanInspectionItem[];
  supplementalRequirements: string[];
  createdAt: string;
  updatedAt: string;
  cancellationReason?: string;
  audit: Array<{ id: string; action: string; actor: string; occurredAt: string; detail: string }>;
  version?: number;
};

export type UpgradePlan = UpgradePlanRecord;
export type UpgradeStage = UpgradePlanStageRecord;

export type UpgradePlanDraft = Omit<
  UpgradePlanRecord,
  "id" | "planNumber" | "lifecycleStatus" | "createdAt" | "updatedAt" | "audit" | "inspectionItems"
> & { inspectionItemSelections: UpgradePlanInspectionSelection[] };

export type UpgradePlanQuery = {
  q?: string;
  type?: "all" | UpgradePlanType;
  status?: "all" | UpgradePlanLifecycleStatus;
  owner?: string;
  positions?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

export type CalendarView = "agenda" | "month" | "week" | "timeline";
export type CalendarEventType = "qualification_expiry" | "upgrade_stage";
export type AdminCalendarEvent = {
  id: string;
  type: CalendarEventType;
  date: string;
  endDate: string;
  title: string;
  pilotId: string;
  pilotName: string;
  employeeNumber: string;
  unit: string;
  positionCode?: string;
  positionName?: string;
  qualificationId?: QualificationId;
  qualificationName?: string;
  qualificationTranslations?: Record<string, string>;
  qualificationRecord?: AdminEditableQualificationRecord;
  qualificationValidityRule?: ValidityRule;
  planId?: UpgradePlanId;
  planNumber?: string;
  planTitle?: string;
  planLifecycleStatus?: UpgradePlanLifecycleStatus;
  stageId?: string;
  stageCode?: UpgradeStageCode;
  stageName?: string;
  stageStatus?: UpgradeStageStatus;
  owner?: string;
  notes?: string;
  inspectionItems?: string[];
  daysRemaining?: number | null;
  status?: QualificationStatus;
  statusReason?: string;
  statusLabel?: string;
  readonly: boolean;
};

export type CalendarQuery = {
  view?: CalendarView;
  date?: string;
  type?: "all" | CalendarEventType;
  qualification?: "all" | QualificationId;
  units?: string;
  positions?: string;
  q?: string;
  from?: string;
  to?: string;
};

export type CalendarDayQualificationQuery = Omit<CalendarQuery, "view" | "date" | "from" | "to"> & {
  date: string;
};

export type AdminEditableQualificationRecord = ReviewCredentialFields &
  QualificationDateState & {
    recordId: string;
    qualificationId: QualificationId;
    qualificationName: string;
    qualificationTranslations?: Record<string, string>;
    lastVerifiedOn: string;
    version: number;
  };

export type CalendarDayQualificationSlot = {
  qualificationId: QualificationId;
  qualificationName: string;
  qualificationTranslations?: Record<string, string>;
  validityRule: ValidityRule;
  record: AdminEditableQualificationRecord | null;
};

export type CalendarDayPilotQualifications = {
  pilotId: string;
  pilotName: string;
  employeeNumber: string;
  unit: string;
  nodes: AdminCalendarEvent[];
  qualifications: CalendarDayQualificationSlot[];
};

export type CalendarDayQualificationRoster = {
  date: string;
  eventCount: number;
  pilots: CalendarDayPilotQualifications[];
};

export type AdminQualificationRecordUpdateInput = ReviewCredentialFields & {
  expectedVersion: number;
};

export type AdminQualificationRecordCreateInput = ReviewCredentialFields;

export type QualificationConfigId = string;
export type ValidityRule =
  | { kind: "fixed_months"; baseDateField: "issueDate" | "trainingDate"; months: number }
  | { kind: "manual_expiry" }
  | { kind: "non_expiring" };
export type OcrCheckConfig = {
  enabled: boolean;
  credentialNumber: boolean;
  holderMatch: boolean;
  expiryDate: boolean;
  issuingAuthoritySeal: boolean;
};
export type QualificationFieldValueType = "text" | "digits" | "english" | "alphanumeric";
export type QualificationCustomField = {
  id: string;
  label: string;
  valueType: QualificationFieldValueType;
  required: boolean;
  minLength: number;
  maxLength: number;
  placeholder: string;
};
export type QualificationConfig = {
  id: QualificationConfigId;
  qualificationId?: QualificationId;
  positionCode: string;
  code: string;
  name: string;
  translations: Record<string, string>;
  core: boolean;
  locked: boolean;
  active: boolean;
  customFields: QualificationCustomField[];
  parameterRestriction: QualificationParameterRestriction;
  validityRule: ValidityRule;
  reminders: {
    firstDays: number;
    secondDays: number;
    dueRecipients?: Array<"PERSON" | "ADMIN" | "SUPER_ADMIN">;
    expiredRecipients?: Array<"PERSON" | "ADMIN" | "SUPER_ADMIN">;
  };
  ocrChecks: OcrCheckConfig;
  createdAt: string;
  updatedAt: string;
  version?: number;
};
export type QualificationConfigInput = Omit<
  QualificationConfig,
  | "id"
  | "positionCode"
  | "code"
  | "core"
  | "locked"
  | "createdAt"
  | "updatedAt"
  | "qualificationId"
  | "translations"
> & { translations?: Record<string, string>; locale?: "zh-CN" | "en-US" };

export type QualificationConfigCreateInput = QualificationConfigInput & {
  positionCode: string;
  kind: "core" | "supplemental";
};

export type NotificationLogId = string;
export type NotificationType =
  | "qualification_expiry"
  | "upgrade_stage_reminder"
  | "stage_date_changed"
  | "stage_completed"
  | "review_returned"
  | "review_approved"
  | "upgrade_created"
  | "upgrade_resumed"
  | "delivery_failed"
  | "pilot_access_link";
export type NotificationChannel = "feishu" | "sms" | "in_app";
export type NotificationDeliveryStatus =
  "queued" | "sending" | "provider_accepted" | "delivered" | "unknown" | "sent" | "failed";
export type NotificationAttempt = {
  id: string;
  attemptedAt: string;
  status: NotificationDeliveryStatus;
  detail: string;
  attemptNumber?: number;
  errorCategory?: string;
};
export type NotificationLog = {
  id: NotificationLogId;
  type: NotificationType;
  channel: NotificationChannel;
  status: NotificationDeliveryStatus;
  pilotId?: string;
  pilotName: string;
  employeeNumber?: string;
  target: string;
  summary: string;
  message: string;
  createdAt: string;
  sentAt?: string;
  attempts: NotificationAttempt[];
  version?: number;
  /** @deprecated Mock-only compatibility marker. */
  mock?: true;
};
export type NotificationQuery = {
  q?: string;
  type?: "all" | NotificationType;
  channel?: "all" | NotificationChannel;
  status?: "all" | NotificationDeliveryStatus;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};
export type NotificationSummary = { sentToday: number; failedToday: number; queued: number };

export type PilotNotificationItem = {
  id: string;
  type: NotificationType;
  summary: string;
  message: string;
  createdAt: string;
  readAt: string | null;
};

export type PilotHealth =
  "unconfigured" | "missing" | "incomplete" | "normal" | "expiring" | "expired";
export type PilotUpgradeFilter = "all" | "active" | "none";
export type PilotStatusFilter = "all" | "active" | "inactive";
export type PilotRole = "机长" | "副驾驶";

export type PilotManagementInput = {
  employeeNumber: string;
  displayName: string;
  mobile: string;
  aircraftType: string;
  roleCode: PilotRoleCode;
  unitCode: string;
  rankCode: string;
};

export type PilotManagementMeta = {
  units: Array<{ id: string; code: string; name: string }>;
  qualifications: Array<{
    id: string;
    code: string;
    name: string;
    translations?: Record<string, string>;
    validityRule: ValidityRule;
    ruleVersion: number;
    parameterRestriction: QualificationConfig["parameterRestriction"];
  }>;
  csvHeaders: string[];
};

export type PilotImportQualification = {
  qualificationId: string;
  qualificationCode: string;
  qualificationName: string;
  qualificationTranslations?: Record<string, string>;
  issueDate: string;
  trainingDate: string;
  expiryDate: string;
  levelOrParameter: string;
};

export type PilotImportRow = {
  rowNumber: number;
  input: PilotManagementInput;
  qualifications: PilotImportQualification[];
};

export type PilotImportRowPreview = {
  rowNumber: number;
  employeeNumber: string;
  displayName: string;
  qualificationCount: number;
  errors: string[];
};

export type PilotImportPreview = {
  total: number;
  validCount: number;
  errorCount: number;
  createCount: number;
  updateCount: number;
  fileErrors: string[];
  rows: PilotImportRowPreview[];
};

export type PilotImportMode = "create_only" | "merge";

export type PilotImportResult = {
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  qualificationCount: number;
  pilotIds: string[];
};

export type PilotQualificationRecord = QualificationRecord &
  ReviewCredentialFields & {
    lastVerifiedOn: string;
    version?: number;
    audit?: ReviewAuditEvent[];
  };

export type AdminPilotListItem = {
  id: string;
  employeeNumber: string;
  displayName: string;
  initials: string;
  mobile: string;
  roleCode: PilotRoleCode;
  role: string;
  aircraftType: string;
  unit: string;
  unitCode: string;
  rankCode: string;
  active: boolean;
  version: number;
  health: PilotHealth;
  expiredCount: number;
  expiringCount: number;
  activeUpgradeTitle: string | null;
};

export type AdminPilotEntity = {
  id: string;
  employeeNumber: string;
  displayName: string;
  initials: string;
  mobile: string;
  roleCode: PilotRoleCode;
  aircraftType: string;
  unit: string;
  unitCode: string;
  rankLabel: string;
  active: boolean;
  version: number;
  qualifications: PilotQualificationRecord[];
  activeUpgradePlanId: UpgradePlanId | null;
  electronicFiles: Array<{ id: string; name: string; addedAt: string }>;
};

export type AdminStateV4 = {
  pilots: AdminPilotEntity[];
  reviews: QualificationReview[];
  upgradePlans: UpgradePlanRecord[];
  qualificationConfigs: QualificationConfig[];
  notificationLogs: NotificationLog[];
};

export type AdminPilotDetail = AdminPilotListItem & {
  rankLabel: string;
  qualifications: Qualification[];
  qualificationRecords: PilotQualificationRecord[];
  upgradePlan: UpgradePlan | null;
  reviews: QualificationReview[];
  electronicFiles: Array<{ id: string; name: string; addedAt: string }>;
  systemAudit: ReviewAuditEvent[];
};

export type PilotDirectoryQuery = {
  q?: string;
  health?: "all" | PilotHealth;
  upgrade?: PilotUpgradeFilter;
  status?: PilotStatusFilter;
  page?: number;
  pageSize?: number;
};

export type ReviewListQuery = {
  q?: string;
  status?: "all" | ReviewHumanStatus;
  ai?: "all" | ReviewAiStatus;
  page?: number;
  pageSize?: number;
};

export type PaginatedResult<T> = {
  timezones?: string[];
  evaluatedAt?: string;
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type QualificationAlert = {
  pilotId: string;
  pilotName: string;
  qualification: Qualification;
  daysRemaining: number;
};

export type WeeklyUpgradeItem = {
  planId: string;
  pilotId: string;
  pilotName: string;
  role: string;
  planTitle: string;
  stage: UpgradeStage;
};

export type AdminDashboardSummary = {
  timezones?: string[];
  evaluatedAt?: string;
  missingCount?: number;
  incompleteCount?: number;
  expiredCount: number;
  dueIn7DaysCount: number;
  dueIn30DaysCount: number;
  pendingReviewCount: number;
  weeklyUpgradeCount: number;
  delayedUpgradeCount: number;
  pendingReviews: QualificationReview[];
  qualificationAlerts: QualificationAlert[];
  weeklyUpgrades: WeeklyUpgradeItem[];
  delayedUpgrades: WeeklyUpgradeItem[];
};

export type AccessLinkRequest = { employeeNumber: string; mobile: string };
export type AccessLinkReceipt = { accepted: true; retryAfterSeconds?: number };

export type EvidenceImageRef = {
  id: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
  status: string;
};

export interface PilotIdentityService {
  requestAccessLink(request: AccessLinkRequest): Promise<ServiceResult<AccessLinkReceipt>>;
  getActiveProfile(): PilotProfile | null;
  getProfile(): Promise<ServiceResult<PilotProfile | null>>;
}

export interface QualificationService {
  listForPilot(pilotId: string): Promise<ServiceResult<QualificationSection[]>>;
  getById(id: QualificationId): Promise<ServiceResult<Qualification | null>>;
  listForPreview(): Promise<ServiceResult<QualificationSummary[]>>;
}

export interface DocumentIntelligenceService {
  recognizeDates(
    fileOrEvidenceId: string | Pick<File, "name" | "type" | "size">,
    scenario?: PilotFlowScenario,
  ): Promise<ServiceResult<DocumentAssistState>>;
  reviewDocument(
    draft: QualificationUpdateDraft,
    scenario?: PilotFlowScenario,
  ): Promise<ServiceResult<DocumentAssistState>>;
  inspectForPreview(): Promise<ServiceResult<DocumentInsight>>;
}

export interface SubmissionService {
  submitQualificationUpdate(
    draft: QualificationUpdateDraft,
  ): Promise<ServiceResult<SubmissionReceipt>>;
  getReceipt(id: string): SubmissionReceipt | null;
  /** Remote adapters resolve receipts from the durable API; Mock keeps the synchronous compatibility path. */
  getReceiptAsync?(id: string): Promise<ServiceResult<SubmissionReceipt | null>>;
}

export interface EvidenceImageService {
  uploadProcessedJpeg(file: Blob): Promise<ServiceResult<EvidenceImageRef>>;
  getSignedUrl(id: string): Promise<ServiceResult<{ url: string; expiresAt: string }>>;
}

// 第一批开发验收页仍消费这些兼容类型；业务页不依赖它们。
export type QualificationSummary = {
  id: string;
  title: string;
  status: "valid" | "expiring" | "expired" | "review";
  expiresOn?: string;
};

export type ReviewItem = {
  id: string;
  subject: string;
  qualification: string;
  status: "pending" | "matched" | "needs-review";
};

export type DocumentInsight = {
  confidence: number;
  fields: Record<string, string | undefined>;
  warnings: string[];
};

export type NotificationMessage = {
  id: string;
  title: string;
  body: string;
  channel: "in-app" | "placeholder";
};

export interface AdminDashboardService {
  getSummary(): Promise<ServiceResult<AdminDashboardSummary>>;
}

export interface PilotDirectoryService {
  list(query: PilotDirectoryQuery): Promise<ServiceResult<PaginatedResult<AdminPilotListItem>>>;
  getById(id: string): Promise<ServiceResult<AdminPilotDetail | null>>;
  getManagementMeta(): Promise<ServiceResult<PilotManagementMeta>>;
  getCsvTemplate(): Promise<ServiceResult<{ filename: string; content: string }>>;
  getCsvExport(unitId?: string): Promise<ServiceResult<{ filename: string; content: string }>>;
  create(input: PilotManagementInput): Promise<ServiceResult<AdminPilotDetail>>;
  update(
    id: string,
    input: PilotManagementInput & { active: boolean; expectedVersion: number },
  ): Promise<ServiceResult<AdminPilotDetail>>;
  previewImport(
    csvText: string,
    mode?: PilotImportMode,
  ): Promise<ServiceResult<PilotImportPreview>>;
  importCsv(
    csvText: string,
    mode?: PilotImportMode,
    confirmMerge?: boolean,
  ): Promise<ServiceResult<PilotImportResult>>;
  updateQualificationRecord(
    pilotId: string,
    qualificationId: QualificationId,
    input: AdminQualificationRecordUpdateInput,
  ): Promise<ServiceResult<AdminEditableQualificationRecord>>;
  createQualificationRecord(
    pilotId: string,
    qualificationId: QualificationId,
    input: AdminQualificationRecordCreateInput,
  ): Promise<ServiceResult<AdminEditableQualificationRecord>>;
}

export interface ReviewService {
  list(query: ReviewListQuery): Promise<ServiceResult<PaginatedResult<QualificationReview>>>;
  getById(id: ReviewId): Promise<ServiceResult<QualificationReview | null>>;
  correct(
    id: ReviewId,
    input: ReviewCorrectionInput & { expectedVersion?: number },
  ): Promise<ServiceResult<QualificationReview>>;
  approve(
    id: ReviewId,
    input: { confirmed: boolean; note?: string; expectedVersion?: number },
  ): Promise<ServiceResult<QualificationReview>>;
  returnForChanges(
    id: ReviewId,
    input: { reason: string; expectedVersion?: number },
  ): Promise<ServiceResult<QualificationReview>>;
  listForPreview(): Promise<ServiceResult<ReviewItem[]>>;
}

export interface NotificationService {
  getSummary(): Promise<ServiceResult<NotificationSummary>>;
  list(query: NotificationQuery): Promise<ServiceResult<PaginatedResult<NotificationLog>>>;
  getById(id: NotificationLogId): Promise<ServiceResult<NotificationLog | null>>;
  retry(id: NotificationLogId, expectedVersion?: number): Promise<ServiceResult<NotificationLog>>;
  listForPreview(): Promise<ServiceResult<NotificationMessage[]>>;
}

export interface CalendarService {
  listEvents(query: CalendarQuery): Promise<ServiceResult<AdminCalendarEvent[]>>;
  getEvent(id: string): Promise<ServiceResult<AdminCalendarEvent | null>>;
  getDayQualificationRoster(
    query: CalendarDayQualificationQuery,
  ): Promise<ServiceResult<CalendarDayQualificationRoster>>;
}

export interface UpgradePlanService {
  list(query: UpgradePlanQuery): Promise<ServiceResult<PaginatedResult<UpgradePlanRecord>>>;
  getById(id: UpgradePlanId): Promise<ServiceResult<UpgradePlanRecord | null>>;
  listInspectionItems(): Promise<ServiceResult<InspectionItem[]>>;
  saveDraft(input: UpgradePlanDraft): Promise<ServiceResult<UpgradePlanRecord>>;
  createAndStart(input: UpgradePlanDraft): Promise<ServiceResult<UpgradePlanRecord>>;
  update(
    id: UpgradePlanId,
    input: UpgradePlanDraft & { expectedVersion: number },
  ): Promise<ServiceResult<UpgradePlanRecord>>;
  rescheduleStage(
    planId: UpgradePlanId,
    stageId: string,
    input: { plannedStart: string; plannedEnd: string; notes?: string; expectedVersion?: number },
  ): Promise<ServiceResult<UpgradePlanRecord>>;
  completeStage(
    planId: UpgradePlanId,
    stageId: string,
    input: { completedOn: string; resultSummary: string; expectedVersion?: number },
  ): Promise<ServiceResult<UpgradePlanRecord>>;
  start(id: UpgradePlanId, expectedVersion?: number): Promise<ServiceResult<UpgradePlanRecord>>;
  pause(id: UpgradePlanId, expectedVersion?: number): Promise<ServiceResult<UpgradePlanRecord>>;
  resume(id: UpgradePlanId, expectedVersion?: number): Promise<ServiceResult<UpgradePlanRecord>>;
  cancel(
    id: UpgradePlanId,
    input: { reason: string; expectedVersion?: number },
  ): Promise<ServiceResult<UpgradePlanRecord>>;
}

export interface QualificationConfigService {
  list(positionCode: string): Promise<ServiceResult<QualificationConfig[]>>;
  getById(
    positionCode: string,
    id: QualificationConfigId,
  ): Promise<ServiceResult<QualificationConfig | null>>;
  save(
    positionCode: string,
    id: QualificationConfigId,
    input: QualificationConfigInput & { expectedVersion?: number },
  ): Promise<ServiceResult<QualificationConfig>>;
  create(input: QualificationConfigCreateInput): Promise<ServiceResult<QualificationConfig>>;
}
