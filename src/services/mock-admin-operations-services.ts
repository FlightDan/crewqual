import { differenceInCalendarDays, format, parseISO } from "date-fns";
import {
  firstValidationMessage,
  qualificationConfigInputSchema,
  upgradePlanDraftSchema,
  upgradeStageCompletionSchema,
  upgradeStageRescheduleSchema,
} from "@/lib/admin-operations-validation";
import { deriveQualificationDateState, systemClock } from "@/lib/qualification-date-status";
import { adminSettingsService } from "@/services/admin-settings-service";
import { adminStateStore, type AdminStateStore } from "@/services/admin-state-store";
import { CORE_QUALIFICATION_IDS } from "@/types/services";
import type {
  AdminCalendarEvent,
  AdminStateV4,
  CalendarQuery,
  CalendarDayQualificationQuery,
  CalendarDayQualificationRoster,
  CalendarService,
  Clock,
  IdGenerator,
  NotificationLog,
  NotificationService,
  PaginatedResult,
  QualificationConfig,
  QualificationConfigInput,
  QualificationConfigService,
  UpgradePlanDraft,
  UpgradePlanLifecycleStatus,
  UpgradePlanRecord,
  UpgradePlanService,
} from "@/types/services";

const mockInspectionItems = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    code: "oral-theory",
    name: "理论口试检查",
    description: "核验理论知识与口试结论",
    ruleVersion: 1,
  },
];

function copy<T>(value: T): T {
  return structuredClone(value);
}

function timestamp(clock: Clock): string {
  return format(clock.now(), "yyyy-MM-dd HH:mm");
}

async function assertQualificationPosition(positionCode: string) {
  const position = (await adminSettingsService.listPositions()).find(
    (item) => item.code === positionCode,
  );
  if (!position) throw new Error("职位不存在");
}

function paginate<T>(items: T[], requestedPage = 1, pageSize = 8): PaginatedResult<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    total: items.length,
    page,
    pageSize,
    totalPages,
  };
}

export function createSequenceIdGenerator(seed = 3000): IdGenerator {
  let value = seed;
  return { next: (prefix) => `${prefix}-${++value}` };
}

const runtimeIds = createSequenceIdGenerator();

function notification(
  input: Omit<NotificationLog, "id" | "createdAt" | "attempts" | "mock">,
  clock: Clock,
  ids: IdGenerator,
): NotificationLog {
  return { ...input, id: ids.next("NOT"), createdAt: timestamp(clock), attempts: [], mock: true };
}

function deriveCalendarEvents(state: AdminStateV4, clock: Clock): AdminCalendarEvent[] {
  const qualificationEvents = state.pilots.flatMap((pilot) =>
    pilot.qualifications.map((item) => {
      const dateState = deriveQualificationDateState(item.expiresOn, clock);
      return {
        id: `qualification:${pilot.id}:${item.id}`,
        type: "qualification_expiry" as const,
        date: item.expiresOn,
        endDate: item.expiresOn,
        title: `${item.name}${dateState.daysRemaining < 0 ? "已过期" : "到期"}`,
        pilotId: pilot.id,
        pilotName: pilot.displayName,
        employeeNumber: pilot.employeeNumber,
        unit: pilot.unit,
        positionCode: "PILOT",
        positionName: "飞行员",
        qualificationId: item.id,
        qualificationName: item.name,
        daysRemaining: dateState.daysRemaining,
        readonly: true,
      };
    }),
  );
  const planEvents = state.upgradePlans
    .filter((plan) => plan.lifecycleStatus !== "draft" && plan.lifecycleStatus !== "cancelled")
    .flatMap((plan) => {
      const pilot = state.pilots.find((item) => item.id === plan.pilotId);
      if (!pilot) return [];
      return plan.stages.map((stage) => ({
        id: `upgrade:${plan.id}:${stage.id}`,
        type: "upgrade_stage" as const,
        date: stage.plannedStart,
        endDate: stage.plannedEnd,
        title: stage.name,
        pilotId: pilot.id,
        pilotName: pilot.displayName,
        employeeNumber: pilot.employeeNumber,
        unit: pilot.unit,
        positionCode: plan.positionCode ?? "PILOT",
        positionName: plan.positionName ?? "飞行员",
        planId: plan.id,
        planNumber: plan.planNumber,
        planTitle: plan.title,
        planLifecycleStatus: plan.lifecycleStatus,
        stageId: stage.id,
        stageName: stage.name,
        stageStatus: stage.status,
        owner: stage.owner,
        notes: stage.notes,
        readonly: plan.lifecycleStatus === "completed" || plan.lifecycleStatus === "cancelled",
      }));
    });
  return [...qualificationEvents, ...planEvents].sort((a, b) => a.date.localeCompare(b.date));
}

function validateDraft(input: UpgradePlanDraft): UpgradePlanDraft {
  const result = upgradePlanDraftSchema.safeParse(input);
  if (!result.success) throw new Error(firstValidationMessage(result.error));
  return result.data as UpgradePlanDraft;
}

function findPlan(state: AdminStateV4, id: string): UpgradePlanRecord {
  const plan = state.upgradePlans.find((item) => item.id === id);
  if (!plan) throw new Error("未找到升级计划");
  return plan;
}

const conflictStatuses: UpgradePlanLifecycleStatus[] = ["not_started", "active", "paused"];

function assertCanActivate(
  state: AdminStateV4,
  pilotId: string,
  excludedPlanId: string | null,
  clock: Clock,
) {
  const pilot = state.pilots.find((item) => item.id === pilotId);
  if (!pilot) throw new Error("未找到计划飞行员");
  const conflict = state.upgradePlans.find(
    (plan) =>
      plan.pilotId === pilotId &&
      plan.id !== excludedPlanId &&
      conflictStatuses.includes(plan.lifecycleStatus),
  );
  if (conflict) throw new Error(`该飞行员已有活动计划：${conflict.planNumber}`);
  const expired = pilot.qualifications.filter(
    (qualification) =>
      deriveQualificationDateState(qualification.expiresOn, clock).status === "expired",
  );
  if (expired.length)
    throw new Error(`核心资质已过期，无法启动：${expired.map((item) => item.name).join("、")}`);
  return pilot;
}

function updatePlan(state: AdminStateV4, plan: UpgradePlanRecord): AdminStateV4 {
  return {
    ...state,
    upgradePlans: state.upgradePlans.map((item) => (item.id === plan.id ? plan : item)),
  };
}

function derivedQualificationReminders(state: AdminStateV4, clock: Clock): NotificationLog[] {
  const now = clock.now();
  return state.pilots.flatMap((pilot) =>
    pilot.qualifications.flatMap((qualification) => {
      const config = state.qualificationConfigs.find(
        (item) => item.qualificationId === qualification.id && item.active,
      );
      if (!config) return [];
      const days = differenceInCalendarDays(parseISO(qualification.expiresOn), now);
      if (days > config.reminders.firstDays) return [];
      return [
        {
          id: `REM-${pilot.id}-${qualification.id}`,
          type: "qualification_expiry" as const,
          channel: "in_app" as const,
          status: "queued" as const,
          pilotId: pilot.id,
          pilotName: pilot.displayName,
          employeeNumber: pilot.employeeNumber,
          target: "飞行员本人（脱敏目标）",
          summary: `${qualification.name}${days < 0 ? `已过期 ${Math.abs(days)} 天` : `剩余 ${days} 天`}`,
          message: `【资质提醒队列｜Mock 演示】${qualification.name}${days < 0 ? "已过期" : "即将到期"}。此记录按当前配置派生，尚未调用真实渠道。`,
          createdAt: format(now, "yyyy-MM-dd HH:mm"),
          attempts: [],
          mock: true as const,
        },
      ];
    }),
  );
}

export function createMockAdminOperationsServices(
  store: AdminStateStore = adminStateStore,
  clock: Clock = systemClock,
  ids: IdGenerator = runtimeIds,
): {
  calendar: CalendarService;
  upgradePlans: UpgradePlanService;
  qualificationConfigs: QualificationConfigService;
  notifications: NotificationService;
} {
  const calendar: CalendarService = {
    async listEvents(query: CalendarQuery) {
      const q = query.q?.trim().toLocaleLowerCase() ?? "";
      const units = new Set(
        query.units
          ?.split(",")
          .map((unit) => unit.trim())
          .filter(Boolean) ?? [],
      );
      const positions = new Set(
        query.positions
          ?.split(",")
          .map((position) => position.trim())
          .filter(Boolean) ?? [],
      );
      const data = deriveCalendarEvents(store.getSnapshot(), clock).filter(
        (event) =>
          (!query.type || query.type === "all" || event.type === query.type) &&
          (!query.qualification ||
            query.qualification === "all" ||
            event.qualificationId === query.qualification) &&
          (!units.size || units.has(event.unit)) &&
          (!positions.size || (event.positionCode ? positions.has(event.positionCode) : false)) &&
          (!query.from || event.endDate >= query.from) &&
          (!query.to || event.date <= query.to) &&
          (!q ||
            event.pilotName.toLocaleLowerCase().includes(q) ||
            event.employeeNumber.toLocaleLowerCase().includes(q)),
      );
      return { data: copy(data), source: "mock" };
    },
    async getEvent(id) {
      const state = store.getSnapshot();
      const event = deriveCalendarEvents(state, clock).find((item) => item.id === id);
      if (!event || event.type !== "qualification_expiry") {
        return { data: event ? copy(event) : null, source: "mock" };
      }
      const pilot = state.pilots.find((item) => item.id === event.pilotId);
      const record = pilot?.qualifications.find((item) => item.id === event.qualificationId);
      const config = state.qualificationConfigs.find(
        (item) => item.qualificationId === event.qualificationId,
      );
      return {
        data:
          record && config
            ? copy({
                ...event,
                qualificationValidityRule: config.validityRule,
                qualificationRecord: {
                  ...deriveQualificationDateState(record.expiryDate, clock),
                  recordId: event.id,
                  qualificationId: record.id,
                  qualificationName: record.name,
                  credentialNumber: record.credentialNumber,
                  issueDate: record.issueDate,
                  expiryDate: record.expiryDate,
                  issuingAuthority: record.issuingAuthority,
                  levelOrParameter: record.levelOrParameter,
                  lastVerifiedOn: record.lastVerifiedOn,
                  version: record.version ?? 1,
                },
              })
            : copy(event),
        source: "mock",
      };
    },
    async getDayQualificationRoster(query: CalendarDayQualificationQuery) {
      const eventResult = await calendar.listEvents({
        ...query,
        from: query.date,
        to: query.date,
      });
      const state = store.getSnapshot();
      const order = new Map(CORE_QUALIFICATION_IDS.map((id, index) => [id, index]));
      const configs = state.qualificationConfigs
        .filter(
          (config) =>
            config.core &&
            config.qualificationId &&
            CORE_QUALIFICATION_IDS.includes(
              config.qualificationId as (typeof CORE_QUALIFICATION_IDS)[number],
            ),
        )
        .sort(
          (a, b) =>
            (order.get(a.qualificationId as (typeof CORE_QUALIFICATION_IDS)[number]) ?? 999) -
            (order.get(b.qualificationId as (typeof CORE_QUALIFICATION_IDS)[number]) ?? 999),
        );
      const selectedClock = { now: () => new Date(`${query.date}T12:00:00+08:00`) };
      const pilots = [
        ...new Map(
          eventResult.data.map((event) => [
            event.pilotId,
            state.pilots.find((pilot) => pilot.id === event.pilotId)!,
          ]),
        ).values(),
      ]
        .filter(Boolean)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-CN"));
      const data: CalendarDayQualificationRoster = {
        date: query.date,
        eventCount: eventResult.data.length,
        pilots: pilots.map((pilot) => ({
          pilotId: pilot.id,
          pilotName: pilot.displayName,
          employeeNumber: pilot.employeeNumber,
          unit: pilot.unit,
          nodes: eventResult.data.filter((event) => event.pilotId === pilot.id),
          qualifications: configs.map((config) => {
            const qualificationId = config.qualificationId ?? config.code;
            const record = pilot.qualifications.find((item) => item.id === qualificationId);
            return {
              qualificationId,
              qualificationName: config.name,
              validityRule: config.validityRule,
              record: record
                ? {
                    ...deriveQualificationDateState(record.expiryDate, selectedClock),
                    recordId: `qualification:${pilot.id}:${qualificationId}`,
                    qualificationId,
                    qualificationName: config.name,
                    credentialNumber: record.credentialNumber,
                    issueDate: record.issueDate,
                    expiryDate: record.expiryDate,
                    issuingAuthority: record.issuingAuthority,
                    levelOrParameter: record.levelOrParameter,
                    lastVerifiedOn: record.lastVerifiedOn,
                    version: record.version ?? 1,
                  }
                : null,
            };
          }),
        })),
      };
      return { data: copy(data), source: "mock" };
    },
  };

  const upgradePlans: UpgradePlanService = {
    async list(query) {
      const state = store.getSnapshot();
      const q = query.q?.trim().toLocaleLowerCase() ?? "";
      const items = state.upgradePlans
        .filter((plan) => {
          const pilot = state.pilots.find((item) => item.id === plan.pilotId);
          return (
            (!q ||
              plan.title.toLocaleLowerCase().includes(q) ||
              plan.planNumber.toLocaleLowerCase().includes(q) ||
              pilot?.displayName.toLocaleLowerCase().includes(q) ||
              pilot?.employeeNumber.toLocaleLowerCase().includes(q)) &&
            (!query.type || query.type === "all" || plan.type === query.type) &&
            (!query.status || query.status === "all" || plan.lifecycleStatus === query.status) &&
            (!query.owner || plan.overallOwner === query.owner) &&
            (!query.positions ||
              plan.positionCode === query.positions ||
              (!plan.positionCode && query.positions === "PILOT")) &&
            (!query.from || plan.endDate >= query.from) &&
            (!query.to || plan.startDate <= query.to)
          );
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { data: paginate(copy(items), query.page, query.pageSize), source: "mock" };
    },
    async getById(id) {
      const plan = store.getSnapshot().upgradePlans.find((item) => item.id === id);
      return { data: plan ? copy(plan) : null, source: "mock" };
    },
    async listInspectionItems() {
      return { data: copy(mockInspectionItems), source: "mock" };
    },
    async saveDraft(input) {
      const data = validateDraft(input);
      let result: UpgradePlanRecord | null = null;
      store.update((state) => {
        if (!state.pilots.some((pilot) => pilot.id === data.pilotId))
          throw new Error("未找到计划飞行员");
        const occurredAt = timestamp(clock);
        const id = ids.next("PLAN");
        const { inspectionItemSelections, ...planData } = data;
        result = {
          ...planData,
          id,
          planNumber: `UP${format(clock.now(), "yyyyMMdd")}-${id.split("-").at(-1)}`,
          lifecycleStatus: "draft",
          createdAt: occurredAt,
          updatedAt: occurredAt,
          stages: data.stages.map((item, index) => ({
            ...item,
            id: `${id}-stage-${index + 1}`,
            status: "not_started",
          })),
          inspectionItems: inspectionItemSelections.map((selection, index) => ({
            id: `${id}-inspection-${index + 1}`,
            inspectionItemId: selection.inspectionItemId,
            stageId: `${id}-stage-${selection.stageOrder + 1}`,
            stageOrder: selection.stageOrder,
            name:
              mockInspectionItems.find((item) => item.id === selection.inspectionItemId)?.name ??
              "检查项目",
            ruleVersion: 1,
            status: "pending" as const,
          })),
          audit: [
            {
              id: ids.next("AUD"),
              action: "draft_saved",
              actor: "演示管理员",
              occurredAt,
              detail: "仅保存为草稿（Mock）",
            },
          ],
        };
        return { ...state, upgradePlans: [result!, ...state.upgradePlans] };
      });
      return { data: copy(result!), source: "mock" };
    },
    async createAndStart(input) {
      const data = validateDraft(input);
      let result: UpgradePlanRecord | null = null;
      store.update((state) => {
        const pilot = assertCanActivate(state, data.pilotId, null, clock);
        const occurredAt = timestamp(clock);
        const id = ids.next("PLAN");
        const { inspectionItemSelections, ...planData } = data;
        result = {
          ...planData,
          id,
          planNumber: `UP${format(clock.now(), "yyyyMMdd")}-${id.split("-").at(-1)}`,
          lifecycleStatus: "active",
          createdAt: occurredAt,
          updatedAt: occurredAt,
          stages: data.stages.map((item, index) => ({
            ...item,
            id: `${id}-stage-${index + 1}`,
            status: index === 0 ? "scheduled" : "not_started",
          })),
          inspectionItems: inspectionItemSelections.map((selection, index) => ({
            id: `${id}-inspection-${index + 1}`,
            inspectionItemId: selection.inspectionItemId,
            stageId: `${id}-stage-${selection.stageOrder + 1}`,
            stageOrder: selection.stageOrder,
            name:
              mockInspectionItems.find((item) => item.id === selection.inspectionItemId)?.name ??
              "检查项目",
            ruleVersion: 1,
            status: "pending" as const,
          })),
          audit: [
            {
              id: ids.next("AUD"),
              action: "created_started",
              actor: "演示管理员",
              occurredAt,
              detail: "创建并启动升级计划（Mock）",
            },
          ],
        };
        return {
          ...state,
          upgradePlans: [result!, ...state.upgradePlans],
          pilots: state.pilots.map((item) =>
            item.id === pilot.id ? { ...item, activeUpgradePlanId: id } : item,
          ),
          notificationLogs: [
            notification(
              {
                type: "upgrade_stage_reminder",
                channel: "in_app",
                status: "queued",
                pilotId: pilot.id,
                pilotName: pilot.displayName,
                employeeNumber: pilot.employeeNumber,
                target: `${pilot.displayName}及各节点责任人`,
                summary: `升级计划已创建：${data.title}`,
                message: "【升级计划通知｜Mock 演示】计划已进入本地通知队列，未调用真实渠道。",
              },
              clock,
              ids,
            ),
            ...state.notificationLogs,
          ],
        };
      });
      return { data: copy(result!), source: "mock" };
    },
    async update(id, input) {
      const data = validateDraft(input);
      let result: UpgradePlanRecord | null = null;
      store.update((state) => {
        const current = findPlan(state, id);
        if ((current.version ?? 1) !== input.expectedVersion) throw new Error("版本冲突");
        if (["completed", "cancelled"].includes(current.lifecycleStatus))
          throw new Error("计划只读");
        const { inspectionItemSelections, ...planData } = data;
        result = {
          ...current,
          ...planData,
          version: (current.version ?? 1) + 1,
          updatedAt: timestamp(clock),
          inspectionItems: inspectionItemSelections.map((selection, index) => ({
            id: `${id}-inspection-${index + 1}`,
            inspectionItemId: selection.inspectionItemId,
            stageId: current.stages[selection.stageOrder]!.id,
            stageOrder: selection.stageOrder,
            name:
              mockInspectionItems.find((item) => item.id === selection.inspectionItemId)?.name ??
              "检查项目",
            ruleVersion: 1,
            status: "pending" as const,
          })),
        };
        return {
          ...state,
          upgradePlans: state.upgradePlans.map((plan) => (plan.id === id ? result! : plan)),
        };
      });
      return { data: copy(result!), source: "mock" };
    },
    async rescheduleStage(planId, stageId, input) {
      const validation = upgradeStageRescheduleSchema.safeParse(input);
      if (!validation.success) throw new Error(firstValidationMessage(validation.error));
      const data = validation.data;
      let result: UpgradePlanRecord | null = null;
      store.update((state) => {
        const plan = findPlan(state, planId);
        if (["completed", "cancelled"].includes(plan.lifecycleStatus))
          throw new Error("已完成或已取消计划不可编辑");
        const index = plan.stages.findIndex((item) => item.id === stageId);
        if (index < 0) throw new Error("未找到升级节点");
        if (data.plannedStart < plan.startDate || data.plannedEnd > plan.endDate)
          throw new Error("节点日期必须位于整体计划周期内");
        if (index > 0 && data.plannedStart < plan.stages[index - 1]!.plannedEnd)
          throw new Error("节点日期不得早于前一固定顺序节点");
        if (
          index < plan.stages.length - 1 &&
          data.plannedEnd > plan.stages[index + 1]!.plannedStart
        )
          throw new Error("节点日期不得晚于后一固定顺序节点");
        const currentStage = plan.stages[index]!;
        const nextNotes = data.notes || currentStage.notes;
        if (
          data.plannedStart === currentStage.plannedStart &&
          data.plannedEnd === currentStage.plannedEnd &&
          nextNotes === currentStage.notes
        ) {
          result = plan;
          return state;
        }
        const occurredAt = timestamp(clock);
        const stages = plan.stages.map((item) =>
          item.id === stageId
            ? {
                ...item,
                plannedStart: data.plannedStart,
                plannedEnd: data.plannedEnd,
                notes: nextNotes,
              }
            : item,
        );
        result = {
          ...plan,
          stages,
          updatedAt: occurredAt,
          audit: [
            ...plan.audit,
            {
              id: ids.next("AUD"),
              action: "stage_rescheduled",
              actor: "演示管理员",
              occurredAt,
              detail: `${plan.stages[index]!.name}调整为 ${data.plannedStart} 至 ${data.plannedEnd}`,
            },
          ],
        };
        const pilot = state.pilots.find((item) => item.id === plan.pilotId)!;
        const next = updatePlan(state, result);
        return {
          ...next,
          notificationLogs: [
            notification(
              {
                type: "stage_date_changed",
                channel: "in_app",
                status: "queued",
                pilotId: pilot.id,
                pilotName: pilot.displayName,
                employeeNumber: pilot.employeeNumber,
                target: `${pilot.displayName}与${plan.stages[index]!.owner}`,
                summary: `节点日期变更：${plan.stages[index]!.name} → ${data.plannedStart} 至 ${data.plannedEnd}`,
                message: `【节点日期变更｜Mock 演示】${plan.stages[index]!.name}已调整，尚未调用真实渠道。`,
              },
              clock,
              ids,
            ),
            ...state.notificationLogs,
          ],
        };
      });
      return { data: copy(result!), source: "mock" };
    },
    async completeStage(planId, stageId, input) {
      const validation = upgradeStageCompletionSchema.safeParse(input);
      if (!validation.success) throw new Error(firstValidationMessage(validation.error));
      const data = validation.data;
      let result: UpgradePlanRecord | null = null;
      store.update((state) => {
        const plan = findPlan(state, planId);
        if (plan.lifecycleStatus !== "active") throw new Error("仅进行中的计划可以登记节点完成");
        const index = plan.stages.findIndex((item) => item.id === stageId);
        if (index < 0) throw new Error("未找到升级节点");
        const currentStage = plan.stages[index]!;
        if (currentStage.status === "completed") throw new Error("该节点已经完成，不能重复登记");
        if (plan.stages.slice(0, index).some((item) => item.status !== "completed"))
          throw new Error("不能跳过尚未完成的中间节点");
        if (!["scheduled", "in_progress", "delayed"].includes(currentStage.status))
          throw new Error("当前节点尚未进入可完成状态");
        if (data.completedOn < plan.startDate || data.completedOn > plan.endDate)
          throw new Error("完成日期必须位于整体计划周期内");
        const occurredAt = timestamp(clock);
        const stages = plan.stages.map((item, stageIndex) =>
          stageIndex === index
            ? {
                ...item,
                status: "completed" as const,
                completedOn: data.completedOn,
                resultSummary: data.resultSummary,
              }
            : stageIndex === index + 1 && item.status === "not_started"
              ? { ...item, status: "scheduled" as const }
              : item,
        );
        const completed = stages.every((item) => item.status === "completed");
        result = {
          ...plan,
          stages,
          lifecycleStatus: completed ? "completed" : plan.lifecycleStatus,
          updatedAt: occurredAt,
          audit: [
            ...plan.audit,
            {
              id: ids.next("AUD"),
              action: "stage_completed",
              actor: "演示管理员",
              occurredAt,
              detail: `${plan.stages[index]!.name}登记完成：${data.resultSummary}`,
            },
          ],
        };
        const pilot = state.pilots.find((item) => item.id === plan.pilotId)!;
        const next = updatePlan(state, result);
        return {
          ...next,
          pilots: completed
            ? state.pilots.map((item) =>
                item.id === pilot.id ? { ...item, activeUpgradePlanId: null } : item,
              )
            : state.pilots,
          notificationLogs: [
            notification(
              {
                type: "stage_completed",
                channel: "in_app",
                status: "queued",
                pilotId: pilot.id,
                pilotName: pilot.displayName,
                employeeNumber: pilot.employeeNumber,
                target: `${pilot.displayName}与${plan.stages[index]!.owner}`,
                summary: `节点完成：${plan.stages[index]!.name}`,
                message: `【节点完成结果｜Mock 演示】${data.resultSummary}。尚未调用真实渠道。`,
              },
              clock,
              ids,
            ),
            ...state.notificationLogs,
          ],
        };
      });
      return { data: copy(result!), source: "mock" };
    },
    async start(id) {
      let result: UpgradePlanRecord | null = null;
      store.update((state) => {
        const plan = findPlan(state, id);
        if (!["draft", "not_started"].includes(plan.lifecycleStatus))
          throw new Error("当前状态不能启动");
        const pilot = assertCanActivate(state, plan.pilotId, plan.id, clock);
        const occurredAt = timestamp(clock);
        result = {
          ...plan,
          lifecycleStatus: "active",
          stages: plan.stages.map((item, index) =>
            index === 0 && item.status === "not_started" ? { ...item, status: "scheduled" } : item,
          ),
          updatedAt: occurredAt,
          audit: [
            ...plan.audit,
            {
              id: ids.next("AUD"),
              action: "started",
              actor: "演示管理员",
              occurredAt,
              detail: "启动升级计划",
            },
          ],
        } as UpgradePlanRecord;
        const next = updatePlan(state, result);
        return {
          ...next,
          pilots: state.pilots.map((item) =>
            item.id === pilot.id ? { ...item, activeUpgradePlanId: plan.id } : item,
          ),
          notificationLogs: [
            notification(
              {
                type: "upgrade_stage_reminder",
                channel: "in_app",
                status: "queued",
                pilotId: pilot.id,
                pilotName: pilot.displayName,
                employeeNumber: pilot.employeeNumber,
                target: `${pilot.displayName}及各节点责任人`,
                summary: `升级计划已启动：${plan.title}`,
                message: "【升级计划启动｜Mock 演示】计划已进入本地通知队列，未调用真实渠道。",
              },
              clock,
              ids,
            ),
            ...state.notificationLogs,
          ],
        };
      });
      return { data: copy(result!), source: "mock" };
    },
    async pause(id) {
      let result: UpgradePlanRecord | null = null;
      store.update((state) => {
        const plan = findPlan(state, id);
        if (plan.lifecycleStatus !== "active") throw new Error("仅进行中的计划可以暂停");
        const occurredAt = timestamp(clock);
        result = {
          ...plan,
          lifecycleStatus: "paused",
          updatedAt: occurredAt,
          audit: [
            ...plan.audit,
            {
              id: ids.next("AUD"),
              action: "paused",
              actor: "演示管理员",
              occurredAt,
              detail: "暂停升级计划",
            },
          ],
        };
        return updatePlan(state, result);
      });
      return { data: copy(result!), source: "mock" };
    },
    async resume(id) {
      let result: UpgradePlanRecord | null = null;
      store.update((state) => {
        const plan = findPlan(state, id);
        if (plan.lifecycleStatus !== "paused") throw new Error("仅已暂停计划可以恢复");
        assertCanActivate(state, plan.pilotId, plan.id, clock);
        const occurredAt = timestamp(clock);
        result = {
          ...plan,
          lifecycleStatus: "active",
          updatedAt: occurredAt,
          audit: [
            ...plan.audit,
            {
              id: ids.next("AUD"),
              action: "resumed",
              actor: "演示管理员",
              occurredAt,
              detail: "恢复升级计划",
            },
          ],
        };
        return updatePlan(state, result);
      });
      return { data: copy(result!), source: "mock" };
    },
    async cancel(id, input) {
      const reason = input.reason.trim();
      if (reason.length < 5) throw new Error("取消原因至少需要 5 个字符");
      let result: UpgradePlanRecord | null = null;
      store.update((state) => {
        const plan = findPlan(state, id);
        if (!["not_started", "active", "paused"].includes(plan.lifecycleStatus))
          throw new Error("仅未开始、进行中或已暂停计划可以取消");
        const occurredAt = timestamp(clock);
        result = {
          ...plan,
          lifecycleStatus: "cancelled",
          cancellationReason: reason,
          updatedAt: occurredAt,
          audit: [
            ...plan.audit,
            {
              id: ids.next("AUD"),
              action: "cancelled",
              actor: "演示管理员",
              occurredAt,
              detail: `取消升级计划：${reason}`,
            },
          ],
        };
        const next = updatePlan(state, result);
        return {
          ...next,
          pilots: state.pilots.map((item) =>
            item.activeUpgradePlanId === id ? { ...item, activeUpgradePlanId: null } : item,
          ),
        };
      });
      return { data: copy(result!), source: "mock" };
    },
  };

  const qualificationConfigs: QualificationConfigService = {
    async list(positionCode) {
      await assertQualificationPosition(positionCode);
      return {
        data: copy(
          store
            .getSnapshot()
            .qualificationConfigs.filter((item) => item.positionCode === positionCode),
        ),
        source: "mock",
      };
    },
    async getById(positionCode, id) {
      await assertQualificationPosition(positionCode);
      const config = store
        .getSnapshot()
        .qualificationConfigs.find((item) => item.id === id && item.positionCode === positionCode);
      return { data: config ? copy(config) : null, source: "mock" };
    },
    async save(positionCode, id, input) {
      await assertQualificationPosition(positionCode);
      const expectedVersion = input.expectedVersion;
      const validation = qualificationConfigInputSchema.safeParse(input);
      if (!validation.success) throw new Error(firstValidationMessage(validation.error));
      let result: QualificationConfig | null = null;
      store.update((state) => {
        const config = state.qualificationConfigs.find(
          (item) => item.id === id && item.positionCode === positionCode,
        );
        if (!config) throw new Error("未找到资质配置");
        if (expectedVersion && expectedVersion !== (config.version ?? 1))
          throw new Error("资质配置已被其他管理员修改，请刷新后重试");
        if (config.locked && validation.data.name !== config.name)
          throw new Error("模板核心资质不可改名");
        if (config.locked && !validation.data.active) throw new Error("模板核心资质不可停用");
        const normalizedName = validation.data.name.toLocaleLowerCase();
        if (
          state.qualificationConfigs.some(
            (item) =>
              item.id !== id &&
              item.positionCode === positionCode &&
              item.name.toLocaleLowerCase() === normalizedName,
          )
        )
          throw new Error("当前职位已存在同名资质");
        result = {
          ...config,
          ...(validation.data as QualificationConfigInput),
          name: config.locked ? config.name : validation.data.name,
          active: config.locked ? true : validation.data.active,
          updatedAt: timestamp(clock),
          version: (config.version ?? 1) + 1,
        };
        return {
          ...state,
          qualificationConfigs: state.qualificationConfigs.map((item) =>
            item.id === id ? result! : item,
          ),
        };
      });
      return { data: copy(result!), source: "mock" };
    },
    async create(input) {
      const { positionCode, kind, ...configInput } = input;
      await assertQualificationPosition(positionCode);
      const validation = qualificationConfigInputSchema.safeParse(configInput);
      if (!validation.success) throw new Error(firstValidationMessage(validation.error));
      let result: QualificationConfig | null = null;
      store.update((state) => {
        const name = validation.data.name.toLocaleLowerCase();
        if (
          state.qualificationConfigs.some(
            (item) => item.positionCode === positionCode && item.name.toLocaleLowerCase() === name,
          )
        )
          throw new Error("资质项目名称已存在");
        const occurredAt = timestamp(clock);
        const id = ids.next("custom");
        result = {
          ...(validation.data as QualificationConfigInput),
          id,
          qualificationId: id,
          positionCode,
          code: `${positionCode.toLowerCase().replaceAll("_", "-")}-custom-${id.split("-").at(-1)}`,
          core: kind === "core",
          locked: false,
          createdAt: occurredAt,
          updatedAt: occurredAt,
          version: 1,
        };
        return { ...state, qualificationConfigs: [...state.qualificationConfigs, result!] };
      });
      return { data: copy(result!), source: "mock" };
    },
  };

  const notifications: NotificationService = {
    async getSummary() {
      const today = format(clock.now(), "yyyy-MM-dd");
      const logs = [
        ...store.getSnapshot().notificationLogs,
        ...derivedQualificationReminders(store.getSnapshot(), clock),
      ];
      return {
        data: {
          sentToday: logs.filter((item) => item.status === "sent" && item.sentAt?.startsWith(today))
            .length,
          failedToday: logs.filter(
            (item) => item.status === "failed" && item.createdAt.startsWith(today),
          ).length,
          queued: logs.filter((item) => item.status === "queued").length,
        },
        source: "mock",
      };
    },
    async list(query) {
      const q = query.q?.trim().toLocaleLowerCase() ?? "";
      const logs = [
        ...store.getSnapshot().notificationLogs,
        ...derivedQualificationReminders(store.getSnapshot(), clock),
      ]
        .filter(
          (item) =>
            (!q ||
              item.summary.toLocaleLowerCase().includes(q) ||
              item.pilotName.toLocaleLowerCase().includes(q) ||
              item.employeeNumber?.toLocaleLowerCase().includes(q)) &&
            (!query.type || query.type === "all" || item.type === query.type) &&
            (!query.channel || query.channel === "all" || item.channel === query.channel) &&
            (!query.status || query.status === "all" || item.status === query.status) &&
            (!query.from || (item.sentAt ?? item.createdAt).slice(0, 10) >= query.from) &&
            (!query.to || (item.sentAt ?? item.createdAt).slice(0, 10) <= query.to),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { data: paginate(copy(logs), query.page, query.pageSize), source: "mock" };
    },
    async getById(id) {
      const logs = [
        ...store.getSnapshot().notificationLogs,
        ...derivedQualificationReminders(store.getSnapshot(), clock),
      ];
      const log = logs.find((item) => item.id === id);
      return { data: log ? copy(log) : null, source: "mock" };
    },
    async retry(id) {
      let queued: NotificationLog | null = null;
      store.update((state) => {
        const log = state.notificationLogs.find((item) => item.id === id);
        if (!log) throw new Error("未找到通知记录");
        if (log.status !== "failed") throw new Error("只有发送失败的 Mock 记录可以重发");
        queued = {
          ...log,
          status: "queued",
          attempts: [
            ...log.attempts,
            {
              id: ids.next("ATT"),
              attemptedAt: timestamp(clock),
              status: "queued",
              detail: "Mock 重新发送已进入队列",
            },
          ],
        };
        return {
          ...state,
          notificationLogs: state.notificationLogs.map((item) => (item.id === id ? queued! : item)),
        };
      });
      let result: NotificationLog | null = null;
      store.update((state) => {
        const log = state.notificationLogs.find((item) => item.id === id)!;
        const attemptedAt = timestamp(clock);
        result = {
          ...log,
          status: "sent",
          sentAt: attemptedAt,
          attempts: [
            ...log.attempts,
            {
              id: ids.next("ATT"),
              attemptedAt,
              status: "sent",
              detail: "确定性 Mock 重发成功，未调用真实渠道",
            },
          ],
        };
        return {
          ...state,
          notificationLogs: state.notificationLogs.map((item) => (item.id === id ? result! : item)),
        };
      });
      return { data: copy(result!), source: "mock" };
    },
    async listForPreview() {
      return {
        data: store
          .getSnapshot()
          .notificationLogs.slice(0, 2)
          .map((item) => ({
            id: item.id,
            title: item.summary,
            body: item.message,
            channel: "placeholder" as const,
          })),
        source: "mock",
      };
    },
  };

  return { calendar, upgradePlans, qualificationConfigs, notifications };
}

export const mockAdminOperationsServices = createMockAdminOperationsServices();
