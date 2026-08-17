import { CORE_QUALIFICATION_CATALOG, UPGRADE_STAGE_NAMES } from "@/types/services";
import type {
  AdminPilotEntity,
  AdminStateV4,
  EffectiveQualificationRecord,
  NotificationLog,
  PilotQualificationRecord,
  QualificationConfig,
  QualificationId,
  QualificationReview,
  ReviewAiStatus,
  ReviewCredentialFields,
  ReviewFieldComparison,
  UpgradePlanLifecycleStatus,
  UpgradePlanRecord,
  UpgradePlanStageRecord,
  UpgradePlanType,
} from "@/types/services";

export type AdminMockState = AdminStateV4;
export type { AdminPilotEntity } from "@/types/services";

export const qualificationDefinitions = CORE_QUALIFICATION_CATALOG.map((item) => ({ ...item }));

const defaultExpiries = [
  "2027-08-10",
  "2027-01-20",
  "2027-12-15",
  "2028-06-30",
  "2028-03-15",
  "2027-02-10",
] as const;

function qualificationsFor(
  pilotCode: string,
  expiryOverrides: Partial<Record<QualificationId, string>> = {},
): PilotQualificationRecord[] {
  return qualificationDefinitions.map((item, index) => ({
    id: item.id,
    name: item.name,
    parameter: item.parameter,
    cycleMonths: item.cycleMonths,
    expiresOn: expiryOverrides[item.id] ?? defaultExpiries[index]!,
    credentialNumber: `SANITIZED-${pilotCode}-${index + 1}`,
    issueDate: "2026-01-10",
    expiryDate: expiryOverrides[item.id] ?? defaultExpiries[index]!,
    issuingAuthority: "示例签发机构（已脱敏）",
    levelOrParameter: item.parameter,
    lastVerifiedOn: "2026-07-20",
  }));
}

function stage(
  planId: string,
  index: number,
  input: Omit<UpgradePlanStageRecord, "id" | "name">,
): UpgradePlanStageRecord {
  return {
    id: `${planId}-stage-${index + 1}`,
    name: UPGRADE_STAGE_NAMES[index]!,
    ...input,
  };
}

function createPlan(input: {
  id: string;
  planNumber: string;
  pilotId: string;
  title: string;
  type: UpgradePlanType;
  lifecycleStatus: UpgradePlanLifecycleStatus;
  startDate: string;
  endDate: string;
  overallOwner: string;
  leadDepartment?: string;
  cancellationReason?: string;
  stages: Array<Omit<UpgradePlanStageRecord, "id" | "name">>;
}): UpgradePlanRecord {
  return {
    ...input,
    leadDepartment: input.leadDepartment ?? "一大队一中队升级评估委员会",
    stages: input.stages.map((item, index) => stage(input.id, index, item)),
    inspectionItems: [],
    supplementalRequirements: ["应急生存特情训练（补充要求）"],
    createdAt: "2026-06-01 09:00",
    updatedAt: "2026-08-14 09:00",
    audit: [
      {
        id: `${input.id}-created`,
        action: "created",
        actor: "演示管理员",
        occurredAt: "2026-06-01 09:00",
        detail: "创建升级计划（Mock）",
      },
    ],
  };
}

const upgradePlans: UpgradePlanRecord[] = [
  createPlan({
    id: "upgrade-01",
    planNumber: "UP20260001",
    pilotId: "pilot-demo-01",
    title: "副驾驶升级机长（常规路径）",
    type: "captain_upgrade",
    lifecycleStatus: "active",
    startDate: "2026-06-01",
    endDate: "2026-10-31",
    overallOwner: "陈教员（示例）",
    stages: [
      {
        status: "completed",
        plannedStart: "2026-06-10",
        plannedEnd: "2026-06-20",
        completedOn: "2026-06-18",
        owner: "陈教员（示例）",
        notes: "理论基础考核",
        resultSummary: "理论口试通过，成绩优秀",
      },
      {
        status: "completed",
        plannedStart: "2026-06-25",
        plannedEnd: "2026-07-05",
        completedOn: "2026-07-04",
        owner: "中队评估委员会",
        notes: "综合能力评估",
        resultSummary: "中队评估通过",
      },
      {
        status: "completed",
        plannedStart: "2026-07-06",
        plannedEnd: "2026-07-15",
        completedOn: "2026-07-17",
        owner: "大队评估委员会",
        notes: "大队复核",
        resultSummary: "大队评估通过",
        delayDays: 2,
      },
      {
        status: "completed",
        plannedStart: "2026-07-20",
        plannedEnd: "2026-08-05",
        completedOn: "2026-08-12",
        owner: "林教员（模拟机）",
        notes: "训练资源调整后完成",
        resultSummary: "模拟机检查通过（延期完成）",
        delayDays: 9,
      },
      {
        status: "in_progress",
        plannedStart: "2026-08-12",
        plannedEnd: "2026-08-18",
        owner: "顾教员（航线）",
        notes: "正在执行航线检查",
      },
      {
        status: "scheduled",
        plannedStart: "2026-08-24",
        plannedEnd: "2026-08-28",
        owner: "总飞行师（示例）",
        notes: "完成航线检查后执行",
      },
    ],
  }),
  createPlan({
    id: "upgrade-02",
    planNumber: "UP20260002",
    pilotId: "pilot-demo-02",
    title: "副驾驶升级左座",
    type: "level_upgrade",
    lifecycleStatus: "not_started",
    startDate: "2026-08-20",
    endDate: "2026-12-20",
    overallOwner: "周教员（示例）",
    stages: [
      {
        status: "scheduled",
        plannedStart: "2026-08-20",
        plannedEnd: "2026-08-25",
        owner: "张教员（示例）",
        notes: "理论准备",
      },
      {
        status: "not_started",
        plannedStart: "2026-09-01",
        plannedEnd: "2026-09-07",
        owner: "中队评估委员会",
        notes: "等待前序节点",
      },
      {
        status: "not_started",
        plannedStart: "2026-09-15",
        plannedEnd: "2026-09-20",
        owner: "大队评估委员会",
        notes: "等待前序节点",
      },
      {
        status: "not_started",
        plannedStart: "2026-10-01",
        plannedEnd: "2026-10-10",
        owner: "林教员（模拟机）",
        notes: "A320 模拟机",
      },
      {
        status: "not_started",
        plannedStart: "2026-11-01",
        plannedEnd: "2026-11-30",
        owner: "顾教员（航线）",
        notes: "航线检查",
      },
      {
        status: "not_started",
        plannedStart: "2026-12-10",
        plannedEnd: "2026-12-15",
        owner: "总飞行师（示例）",
        notes: "实践考试",
      },
    ],
  }),
  createPlan({
    id: "upgrade-03",
    planNumber: "UP20260003",
    pilotId: "pilot-demo-03",
    title: "资格恢复升级计划（已完成示例）",
    type: "qualification_recovery",
    lifecycleStatus: "completed",
    startDate: "2026-01-05",
    endDate: "2026-04-30",
    overallOwner: "恢复训练责任教员（示例）",
    stages: [
      ["2026-01-05", "2026-01-12", "2026-01-11"],
      ["2026-01-20", "2026-01-28", "2026-01-27"],
      ["2026-02-05", "2026-02-12", "2026-02-12"],
      ["2026-02-20", "2026-03-05", "2026-03-04"],
      ["2026-03-10", "2026-04-10", "2026-04-09"],
      ["2026-04-20", "2026-04-25", "2026-04-25"],
    ].map(([plannedStart, plannedEnd, completedOn], index) => ({
      status: "completed" as const,
      plannedStart: plannedStart!,
      plannedEnd: plannedEnd!,
      completedOn: completedOn!,
      owner: `完成示例责任人 ${index + 1}`,
      notes: "历史完成节点",
      resultSummary: "人工登记完成（Mock）",
    })),
  }),
  createPlan({
    id: "upgrade-04",
    planNumber: "UP20260004",
    pilotId: "pilot-demo-04",
    title: "教员资格升级计划",
    type: "instructor_upgrade",
    lifecycleStatus: "paused",
    startDate: "2026-05-01",
    endDate: "2026-11-15",
    overallOwner: "训练主管（示例）",
    stages: [
      {
        status: "completed",
        plannedStart: "2026-05-05",
        plannedEnd: "2026-05-10",
        completedOn: "2026-05-09",
        owner: "张教员（示例）",
        notes: "理论口试",
        resultSummary: "通过",
      },
      {
        status: "completed",
        plannedStart: "2026-05-20",
        plannedEnd: "2026-05-25",
        completedOn: "2026-05-25",
        owner: "中队评估委员会",
        notes: "中队评估",
        resultSummary: "通过",
      },
      {
        status: "delayed",
        plannedStart: "2026-08-10",
        plannedEnd: "2026-08-16",
        owner: "大队评估委员会",
        notes: "计划已暂停，节点保留",
        delayDays: 4,
      },
      {
        status: "not_started",
        plannedStart: "2026-09-01",
        plannedEnd: "2026-09-10",
        owner: "林教员（模拟机）",
        notes: "等待恢复",
      },
      {
        status: "not_started",
        plannedStart: "2026-10-01",
        plannedEnd: "2026-10-20",
        owner: "顾教员（航线）",
        notes: "等待恢复",
      },
      {
        status: "not_started",
        plannedStart: "2026-11-01",
        plannedEnd: "2026-11-10",
        owner: "总飞行师（示例）",
        notes: "等待恢复",
      },
    ],
  }),
  createPlan({
    id: "upgrade-05",
    planNumber: "UP20260005",
    pilotId: "pilot-demo-03",
    title: "核心资质阻断草稿（异常场景）",
    type: "captain_upgrade",
    lifecycleStatus: "draft",
    startDate: "2026-09-01",
    endDate: "2026-12-31",
    overallOwner: "草稿责任教员（示例）",
    stages: [
      ["2026-09-01", "2026-09-10"],
      ["2026-09-11", "2026-09-20"],
      ["2026-09-21", "2026-09-30"],
      ["2026-10-01", "2026-10-15"],
      ["2026-10-16", "2026-11-30"],
      ["2026-12-01", "2026-12-15"],
    ].map(([plannedStart, plannedEnd], index) => ({
      status: "not_started" as const,
      plannedStart: plannedStart!,
      plannedEnd: plannedEnd!,
      owner: `草稿责任人 ${index + 1}`,
      notes: "等待核心资质恢复后启动",
    })),
  }),
  createPlan({
    id: "upgrade-06",
    planNumber: "UP20260006",
    pilotId: "pilot-demo-05",
    title: "已取消型别升级计划（只读示例）",
    type: "type_rating",
    lifecycleStatus: "cancelled",
    startDate: "2026-03-01",
    endDate: "2026-08-30",
    overallOwner: "型别训练责任人（示例）",
    cancellationReason: "训练需求发生确定性调整（Mock）",
    stages: [
      {
        status: "completed",
        plannedStart: "2026-03-01",
        plannedEnd: "2026-03-10",
        completedOn: "2026-03-09",
        owner: "型别理论教员（示例）",
        notes: "取消前已完成",
        resultSummary: "理论口试通过",
      },
      ...[
        ["2026-03-15", "2026-03-22"],
        ["2026-04-01", "2026-04-10"],
        ["2026-05-01", "2026-05-15"],
        ["2026-06-01", "2026-07-31"],
        ["2026-08-10", "2026-08-20"],
      ].map(([plannedStart, plannedEnd], index) => ({
        status: "not_started" as const,
        plannedStart: plannedStart!,
        plannedEnd: plannedEnd!,
        owner: `取消示例责任人 ${index + 2}`,
        notes: "计划取消后保留历史配置",
      })),
    ],
  }),
];

const pilots: AdminPilotEntity[] = [
  {
    id: "pilot-demo-01",
    employeeNumber: "MOCK-1049",
    displayName: "周航（示例）",
    initials: "周",
    mobile: "13800001049",
    role: "副驾驶",
    aircraftType: "A320",
    unit: "一大队一中队",
    unitCode: "DEMO",
    rankLabel: "中队技术排名：14 / 32",
    active: true,
    version: 1,
    qualifications: qualificationsFor("1049", {
      "annual-recurrent-training": "2026-08-31",
      "simulator-recurrent-training": "2026-10-30",
    }),
    activeUpgradePlanId: "upgrade-01",
    electronicFiles: [{ id: "file-01", name: "年度训练摘要（示例）.pdf", addedAt: "2026-07-20" }],
  },
  {
    id: "pilot-demo-02",
    employeeNumber: "MOCK-1284",
    displayName: "王澄（示例）",
    initials: "王",
    mobile: "13800001284",
    role: "副驾驶",
    aircraftType: "A320",
    unit: "一大队一中队",
    unitCode: "DEMO",
    rankLabel: "中队技术排名：18 / 32",
    active: true,
    version: 1,
    qualifications: qualificationsFor("1284", {
      "medical-certificate": "2026-08-05",
      "annual-recurrent-training": "2026-08-18",
    }),
    activeUpgradePlanId: "upgrade-02",
    electronicFiles: [],
  },
  {
    id: "pilot-demo-03",
    employeeNumber: "MOCK-1156",
    displayName: "林川（示例）",
    initials: "林",
    mobile: "13800001156",
    role: "副驾驶",
    aircraftType: "A320",
    unit: "一大队一中队",
    unitCode: "DEMO",
    rankLabel: "中队技术排名：22 / 32",
    active: true,
    version: 1,
    qualifications: qualificationsFor("1156", {
      "dangerous-goods-training": "2026-09-10",
      "icao-english-endorsement": "2026-08-12",
    }),
    activeUpgradePlanId: null,
    electronicFiles: [],
  },
  {
    id: "pilot-demo-04",
    employeeNumber: "MOCK-1522",
    displayName: "吴岚（示例）",
    initials: "吴",
    mobile: "13800001522",
    role: "机长",
    aircraftType: "A320",
    unit: "一大队一中队",
    unitCode: "DEMO",
    rankLabel: "中队技术排名：6 / 32",
    active: true,
    version: 1,
    qualifications: qualificationsFor("1522", {
      "medical-certificate": "2026-08-21",
      "dangerous-goods-training": "2026-08-14",
    }),
    activeUpgradePlanId: "upgrade-04",
    electronicFiles: [{ id: "file-04", name: "教员训练档案（示例）.pdf", addedAt: "2026-06-18" }],
  },
  {
    id: "pilot-demo-05",
    employeeNumber: "MOCK-1301",
    displayName: "赵宁（示例）",
    initials: "赵",
    mobile: "13800001301",
    role: "副驾驶",
    aircraftType: "A320",
    unit: "一大队一中队",
    unitCode: "DEMO",
    rankLabel: "中队技术排名：27 / 32",
    active: true,
    version: 1,
    qualifications: qualificationsFor("1301", {
      "annual-recurrent-training": "2026-09-01",
      "simulator-recurrent-training": "2026-11-12",
    }),
    activeUpgradePlanId: null,
    electronicFiles: [],
  },
];

const fieldLabels: Record<keyof ReviewCredentialFields, string> = {
  credentialNumber: "证件编号",
  issueDate: "签发日期",
  trainingDate: "培训日期",
  expiryDate: "到期日期",
  issuingAuthority: "签发机构",
  levelOrParameter: "等级/参数",
};

function createFieldComparisons(
  fields: ReviewCredentialFields,
  aiStatus: ReviewAiStatus,
): ReviewFieldComparison[] {
  return (Object.keys(fieldLabels) as Array<keyof ReviewCredentialFields>).map((field) => ({
    field,
    label: fieldLabels[field],
    submittedValue: fields[field] ?? "",
    source:
      field === "issueDate" ? "ai" : field === "expiryDate" ? "manual_modified" : "user_manual",
    ...(field === "issueDate" ? { aiOriginalValue: fields[field] ?? "", confidence: 0.98 } : {}),
    ...(field === "expiryDate"
      ? {
          aiOriginalValue: aiStatus === "mismatch" ? "2027-07-10" : "2027-08-09",
          confidence: aiStatus === "unavailable" ? undefined : 0.92,
        }
      : {}),
  }));
}

function effectiveRecord(
  pilotId: string,
  qualificationId: QualificationId,
): EffectiveQualificationRecord {
  const record = pilots
    .find((pilot) => pilot.id === pilotId)!
    .qualifications.find((item) => item.id === qualificationId)!;
  return {
    qualificationId,
    credentialNumber: record.credentialNumber,
    issueDate: record.issueDate,
    expiryDate: record.expiryDate,
    issuingAuthority: record.issuingAuthority,
    levelOrParameter: record.levelOrParameter,
    effectiveFrom: record.lastVerifiedOn,
    status: "active",
  };
}

function createReview(input: {
  id: string;
  pilotId: string;
  qualificationId: QualificationId;
  submittedAt: string;
  aiStatus: ReviewAiStatus;
  humanStatus?: QualificationReview["humanStatus"];
  expiryDate: string;
}): QualificationReview {
  const pilot = pilots.find((item) => item.id === input.pilotId)!;
  const qualification = qualificationDefinitions.find((item) => item.id === input.qualificationId)!;
  const submittedFields: ReviewCredentialFields = {
    credentialNumber: `SANITIZED-NEW-${input.id}`,
    issueDate: "2026-08-10",
    trainingDate: "",
    expiryDate: input.expiryDate,
    issuingAuthority: "示例资质中心（已脱敏）",
    levelOrParameter: qualification.parameter,
  };
  const humanStatus = input.humanStatus ?? "pending";
  return {
    id: input.id,
    pilotId: pilot.id,
    pilotName: pilot.displayName,
    employeeNumber: pilot.employeeNumber,
    role: pilot.role,
    qualificationId: input.qualificationId,
    qualificationName: qualification.name,
    submittedAt: input.submittedAt,
    humanStatus,
    aiStatus: input.aiStatus,
    aiConclusion:
      input.aiStatus === "matched"
        ? "建议通过"
        : input.aiStatus === "question"
          ? "存在疑问，建议人工核对"
          : input.aiStatus === "mismatch"
            ? "字段信息不一致"
            : "AI 辅助服务不可用",
    aiConfidence:
      input.aiStatus === "unavailable" ? undefined : input.aiStatus === "matched" ? 0.98 : 0.82,
    aiReviewedAt: input.aiStatus === "unavailable" ? undefined : "2026-08-14 09:41",
    documentName: `示例凭证-${input.id}.png`,
    documentKind: "sanitized-sample",
    submittedFields,
    fieldComparisons: createFieldComparisons(submittedFields, input.aiStatus),
    aiComparisons: [
      {
        label: "证件姓名与档案匹配",
        result: input.aiStatus === "mismatch" ? "存在差异" : "匹配成功",
        status: input.aiStatus,
        confidence: input.aiStatus === "unavailable" ? undefined : 0.99,
      },
      {
        label: "有效期时间逻辑校对",
        result: input.aiStatus === "question" ? "日期边界需要复核" : "时间逻辑合规",
        status: input.aiStatus,
        confidence: input.aiStatus === "unavailable" ? undefined : 0.94,
      },
    ],
    currentRecord: effectiveRecord(input.pilotId, input.qualificationId),
    corrections: {},
    audit: [
      {
        id: `${input.id}-submitted`,
        action: "submitted",
        actor: pilot.displayName,
        occurredAt: input.submittedAt,
        detail: "飞行员提交资质更新申请（Mock）",
      },
    ],
    ...(humanStatus === "approved"
      ? {
          decision: {
            kind: "approved" as const,
            confirmed: true as const,
            note: "历史 Mock 审核通过",
            actor: "演示管理员",
            occurredAt: "2026-08-13 15:00",
          },
        }
      : humanStatus === "returned"
        ? {
            decision: {
              kind: "returned" as const,
              reason: "示例凭证边缘不完整，请重新上传",
              actor: "演示管理员",
              occurredAt: "2026-08-13 16:00",
            },
          }
        : {}),
  };
}

const reviews: QualificationReview[] = [
  createReview({
    id: "REV-1001",
    pilotId: "pilot-demo-02",
    qualificationId: "medical-certificate",
    submittedAt: "2026-08-14 10:24",
    aiStatus: "matched",
    expiryDate: "2027-08-10",
  }),
  createReview({
    id: "REV-1002",
    pilotId: "pilot-demo-01",
    qualificationId: "annual-recurrent-training",
    submittedAt: "2026-08-14 09:58",
    aiStatus: "question",
    expiryDate: "2027-08-31",
  }),
  createReview({
    id: "REV-1003",
    pilotId: "pilot-demo-03",
    qualificationId: "icao-english-endorsement",
    submittedAt: "2026-08-14 09:36",
    aiStatus: "mismatch",
    expiryDate: "2027-08-12",
  }),
  createReview({
    id: "REV-1004",
    pilotId: "pilot-demo-04",
    qualificationId: "dangerous-goods-training",
    submittedAt: "2026-08-14 08:40",
    aiStatus: "unavailable",
    expiryDate: "2028-08-14",
  }),
  createReview({
    id: "REV-0998",
    pilotId: "pilot-demo-05",
    qualificationId: "simulator-recurrent-training",
    submittedAt: "2026-08-13 14:20",
    aiStatus: "matched",
    humanStatus: "approved",
    expiryDate: "2027-02-10",
  }),
  createReview({
    id: "REV-0997",
    pilotId: "pilot-demo-01",
    qualificationId: "medical-certificate",
    submittedAt: "2026-08-13 11:05",
    aiStatus: "question",
    humanStatus: "returned",
    expiryDate: "2027-08-10",
  }),
];

const qualificationConfigs: QualificationConfig[] = qualificationDefinitions.map(
  (definition, index) => ({
    id: `config-${definition.id}`,
    qualificationId: definition.id,
    code: definition.code,
    name: definition.name,
    core: true,
    active: true,
    parameterRestriction: {
      enabled: index === 0 || index === 3 || index === 5,
      description: index === 5 ? "记录训练机型" : "记录证书等级或限制",
    },
    validityRule:
      index === 4
        ? { kind: "non_expiring" }
        : definition.cycleMonths
          ? { kind: "fixed_months", baseDateField: "issueDate", months: definition.cycleMonths }
          : { kind: "manual_expiry" },
    reminders: { firstDays: 60, secondDays: 30 },
    ocrChecks: {
      enabled: true,
      credentialNumber: true,
      holderMatch: true,
      expiryDate: true,
      issuingAuthoritySeal: false,
    },
    createdAt: "2026-01-01 09:00",
    updatedAt: "2026-07-01 09:00",
  }),
);

const notificationLogs: NotificationLog[] = [
  {
    id: "NOT-1001",
    type: "qualification_expiry",
    channel: "feishu",
    status: "sent",
    pilotId: "pilot-demo-02",
    pilotName: "王澄（示例）",
    employeeNumber: "MOCK-1284",
    target: "飞行员本人（脱敏目标）",
    summary: "民用航空人员体检合格证已过期",
    message: "【资质到期提醒｜Mock 演示】您的民用航空人员体检合格证已过期，请联系中队管理员。",
    createdAt: "2026-08-14 08:30",
    sentAt: "2026-08-14 08:31",
    mock: true,
    attempts: [
      {
        id: "ATT-1001",
        attemptedAt: "2026-08-14 08:31",
        status: "sent",
        detail: "确定性 Mock 发送成功，未调用真实渠道",
      },
    ],
  },
  {
    id: "NOT-1002",
    type: "upgrade_stage_reminder",
    channel: "in_app",
    status: "queued",
    pilotId: "pilot-demo-01",
    pilotName: "周航（示例）",
    employeeNumber: "MOCK-1049",
    target: "飞行员与责任教员",
    summary: "航线检查节点进行中",
    message: "【升级节点提醒｜Mock 演示】航线检查正在执行，请按计划登记完成结果。",
    createdAt: "2026-08-14 09:00",
    mock: true,
    attempts: [],
  },
  {
    id: "NOT-1003",
    type: "review_returned",
    channel: "sms",
    status: "failed",
    pilotId: "pilot-demo-03",
    pilotName: "林川（示例）",
    employeeNumber: "MOCK-1156",
    target: "脱敏手机号 138****0003",
    summary: "人工审核退回：请重新上传完整凭证",
    message:
      "【审核退回｜Mock 演示】AI 标记异常并进入人工复核；管理员决定退回，请重新上传完整凭证。",
    createdAt: "2026-08-14 09:36",
    mock: true,
    attempts: [
      {
        id: "ATT-1003",
        attemptedAt: "2026-08-14 09:37",
        status: "failed",
        detail: "确定性 Mock 首次发送失败，未调用真实短信",
      },
    ],
  },
  {
    id: "NOT-1004",
    type: "review_approved",
    channel: "feishu",
    status: "sent",
    pilotId: "pilot-demo-05",
    pilotName: "赵宁（示例）",
    employeeNumber: "MOCK-1301",
    target: "飞行员本人（脱敏目标）",
    summary: "人工审核通过：模拟机复训",
    message: "【审核通过｜Mock 演示】管理员人工终审确认通过。",
    createdAt: "2026-08-13 15:00",
    sentAt: "2026-08-13 15:01",
    mock: true,
    attempts: [
      {
        id: "ATT-1004",
        attemptedAt: "2026-08-13 15:01",
        status: "sent",
        detail: "确定性 Mock 发送成功",
      },
    ],
  },
];

export function createInitialAdminState(): AdminMockState {
  return structuredClone({ pilots, reviews, upgradePlans, qualificationConfigs, notificationLogs });
}
