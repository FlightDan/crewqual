import { mockE2EClock } from "@/mocks/test-clock";
import {
  projectMockMemberQualifications,
  mockMemberQualificationRecords,
} from "@/services/member-status";
import { endOfWeek, format, isWithinInterval, parseISO, startOfWeek } from "date-fns";
import {
  deriveQualification,
  evaluateQualification,
  fixedClock,
} from "@/lib/qualification-date-status";
import {
  adminQualificationRecordCreateSchema,
  adminQualificationRecordUpdateSchema,
} from "@/lib/admin-operations-validation";
import { qualificationUpdateSchema } from "@/lib/pilot-validation";
import { validateQualificationRuleFields } from "@/lib/qualification-rules";
import {
  createPilotCsvTemplate,
  parsePilotCsv,
  pilotCsvHeaders,
  pilotManagementInputSchema,
} from "@/lib/pilot-management-validation";
import type { AdminMockState } from "@/mocks/admin-fixtures";
import { adminStateStore, type AdminStateStore } from "@/services/admin-state-store";
import type {
  AdminDashboardService,
  AdminDashboardSummary,
  AdminEditableQualificationRecord,
  AdminQualificationRecordCreateInput,
  AdminPilotEntity,
  AdminPilotDetail,
  AdminPilotListItem,
  Clock,
  IdGenerator,
  PaginatedResult,
  PilotDirectoryQuery,
  PilotDirectoryService,
  PilotImportPreview,
  PilotManagementMeta,
  QualificationReview,
  ReviewCredentialFieldName,
  ReviewListQuery,
  ReviewService,
  UpgradePlanRecord,
} from "@/types/services";
import { pilotRoleLabel } from "@/lib/domain-i18n";

const administrator = "演示管理员";

function copy<T>(value: T): T {
  return structuredClone(value);
}

function paginate<T>(items: T[], requestedPage = 1, pageSize = 6): PaginatedResult<T> {
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

const runtimeIdGenerator: IdGenerator = (() => {
  let value = 2000;
  return { next: (prefix) => `${prefix}-${++value}` };
})();

function activePlanFor(
  pilot: AdminPilotEntity,
  plans: UpgradePlanRecord[],
): UpgradePlanRecord | null {
  if (!pilot.activeUpgradePlanId) return null;
  return plans.find((plan) => plan.id === pilot.activeUpgradePlanId) ?? null;
}

function toListItem(
  pilot: AdminPilotEntity,
  plans: UpgradePlanRecord[],
  clock: Clock,
  configs: AdminMockState["qualificationConfigs"],
): AdminPilotListItem {
  const projection = projectMockMemberQualifications(pilot, configs, clock);
  const expiredCount = projection.qualificationCounts.expired;
  const expiringCount = projection.qualificationCounts.due;
  return {
    id: pilot.id,
    employeeNumber: pilot.employeeNumber,
    displayName: pilot.displayName,
    initials: pilot.initials,
    mobile: pilot.mobile,
    roleCode: pilot.roleCode,
    role: pilotRoleLabel(pilot.roleCode),
    aircraftType: pilot.aircraftType,
    unit: pilot.unit,
    unitCode: pilot.unitCode,
    rankCode: pilot.rankLabel,
    active: pilot.active,
    version: pilot.version,
    health:
      projection.health === "valid"
        ? "normal"
        : projection.health === "due"
          ? "expiring"
          : projection.health,
    expiredCount,
    expiringCount,
    activeUpgradeTitle: activePlanFor(pilot, plans)?.title ?? null,
  };
}

function toDetail(
  pilot: AdminPilotEntity,
  reviews: QualificationReview[],
  plans: UpgradePlanRecord[],
  clock: Clock,
  configs: AdminMockState["qualificationConfigs"],
): AdminPilotDetail {
  return {
    ...toListItem(pilot, plans, clock, configs),
    rankLabel: pilot.rankLabel,
    qualifications: mockMemberQualificationRecords(pilot, configs, clock).map((item) =>
      deriveQualification(item, clock),
    ),
    qualificationRecords: copy(pilot.qualifications),
    upgradePlan: copy(activePlanFor(pilot, plans)),
    reviews: copy(reviews.filter((review) => review.pilotId === pilot.id)),
    electronicFiles: copy(pilot.electronicFiles),
    systemAudit: copy(
      [
        ...pilot.qualifications.flatMap((qualification) => qualification.audit ?? []),
        ...reviews
          .filter((review) => review.pilotId === pilot.id)
          .flatMap((review) => review.audit),
      ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    ),
  };
}

function findPendingReview(state: AdminMockState, id: string): QualificationReview {
  const review = state.reviews.find((item) => item.id === id);
  if (!review) throw new Error("未找到审核申请");
  if (review.humanStatus !== "pending") throw new Error("此申请已经处理，不能再次操作");
  return review;
}

function mutationTime(clock: Clock): string {
  return format(clock.now(), "yyyy-MM-dd HH:mm");
}

export function createMockAdminServices(
  store: AdminStateStore = adminStateStore,
  clock: Clock = mockE2EClock,
  idGenerator: IdGenerator = runtimeIdGenerator,
): {
  dashboard: AdminDashboardService;
  pilots: PilotDirectoryService;
  reviews: ReviewService;
} {
  const pilots: PilotDirectoryService = {
    async list(query: PilotDirectoryQuery) {
      const q = query.q?.trim().toLocaleLowerCase() ?? "";
      const capturedClock = fixedClock(clock);
      const items = store
        .getSnapshot()
        .pilots.map((pilot) =>
          toListItem(
            pilot,
            store.getSnapshot().upgradePlans,
            capturedClock,
            store.getSnapshot().qualificationConfigs,
          ),
        )
        .filter(
          (pilot) =>
            (!q ||
              pilot.displayName.toLocaleLowerCase().includes(q) ||
              pilot.employeeNumber.toLocaleLowerCase().includes(q)) &&
            (!query.health || query.health === "all" || pilot.health === query.health) &&
            (!query.status ||
              query.status === "all" ||
              (query.status === "active" ? pilot.active : !pilot.active)) &&
            (!query.upgrade ||
              query.upgrade === "all" ||
              (query.upgrade === "active"
                ? Boolean(pilot.activeUpgradeTitle)
                : !pilot.activeUpgradeTitle)),
        );
      return { data: paginate(items, query.page, query.pageSize), source: "mock" };
    },
    async getById(id) {
      const state = store.getSnapshot();
      const pilot = state.pilots.find((item) => item.id === id);
      return {
        data: pilot
          ? toDetail(
              pilot,
              state.reviews,
              state.upgradePlans,
              fixedClock(clock),
              state.qualificationConfigs,
            )
          : null,
        source: "mock",
      };
    },
    async getManagementMeta() {
      const state = store.getSnapshot();
      const qualifications = state.qualificationConfigs
        .filter((item) => item.active)
        .map((item) => ({
          id: item.qualificationId ?? item.id,
          code: item.code,
          name: item.name,
          validityRule: item.validityRule,
          ruleVersion: item.version ?? 1,
          parameterRestriction: item.parameterRestriction,
        }));
      const units = [
        ...new Map(
          state.pilots.map((pilot) => [
            pilot.unitCode,
            { id: pilot.unitCode, code: pilot.unitCode, name: pilot.unit },
          ]),
        ).values(),
      ];
      const meta: PilotManagementMeta = {
        units,
        qualifications,
        csvHeaders: pilotCsvHeaders(qualifications),
      };
      return { data: meta, source: "mock" };
    },
    async getCsvTemplate() {
      const meta = await pilots.getManagementMeta();
      return {
        data: {
          filename: "CrewQual-飞行员批量导入模板.csv",
          content: createPilotCsvTemplate(meta.data.qualifications),
        },
        source: "mock",
      };
    },
    async getCsvExport(unitId) {
      const meta = (await pilots.getManagementMeta()).data;
      const state = store.getSnapshot();
      const unit = unitId
        ? state.pilots.find((pilot) => pilot.unitCode === unitId)
        : state.pilots[0];
      if (!unit) throw new Error("单位代码不存在或已停用");
      const scoped = state.pilots.filter((pilot) => pilot.unitCode === unit.unitCode);
      const cell = (value: unknown) => {
        const text = value == null ? "" : String(value);
        return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
      };
      const rows = scoped.map((pilot) => {
        const values = [
          pilot.employeeNumber,
          pilot.displayName,
          pilot.mobile,
          pilot.aircraftType,
          pilot.roleCode,
          pilot.unitCode,
          pilot.rankLabel,
        ];
        meta.qualifications.forEach((qualification) => {
          const record = pilot.qualifications.find((item) => item.id === qualification.id);
          values.push(
            record?.issueDate ?? "",
            "",
            record?.expiresOn ?? "",
            record?.parameter ?? "",
          );
        });
        return values.map(cell).join(",");
      });
      return {
        data: {
          filename: `CrewQual-${unit.unitCode}-中队数据.csv`,
          content: `\uFEFF${meta.csvHeaders.map(cell).join(",")}\r\n${rows.join("\r\n")}\r\n`,
        },
        source: "mock",
      };
    },
    async create(rawInput) {
      const input = pilotManagementInputSchema.parse(rawInput);
      const state = store.getSnapshot();
      if (state.pilots.some((pilot) => pilot.employeeNumber === input.employeeNumber)) {
        throw new Error("员工号已存在");
      }
      const unit = state.pilots.find((pilot) => pilot.unitCode === input.unitCode);
      if (!unit) throw new Error("单位代码不存在或已停用");
      const pilot: AdminPilotEntity = {
        id: idGenerator.next("pilot"),
        employeeNumber: input.employeeNumber,
        displayName: input.displayName,
        initials: Array.from(input.displayName.replace(/\s+/g, "")).slice(0, 2).join(""),
        mobile: input.mobile,
        roleCode: input.roleCode,
        aircraftType: input.aircraftType,
        unit: unit.unit,
        unitCode: input.unitCode,
        rankLabel: input.rankCode,
        active: true,
        version: 1,
        qualifications: [],
        activeUpgradePlanId: null,
        electronicFiles: [],
      };
      store.update((current) => ({ ...current, pilots: [...current.pilots, pilot] }));
      return {
        data: toDetail(
          pilot,
          store.getSnapshot().reviews,
          store.getSnapshot().upgradePlans,
          fixedClock(clock),
          store.getSnapshot().qualificationConfigs,
        ),
        source: "mock",
      };
    },
    async update(id, rawInput) {
      const { active, expectedVersion, ...managementInput } = rawInput;
      const input = pilotManagementInputSchema.parse(managementInput);
      let updated: AdminPilotEntity | null = null;
      store.update((state) => {
        const current = state.pilots.find((pilot) => pilot.id === id);
        if (!current) throw new Error("未找到飞行员");
        if (current.version !== expectedVersion) throw new Error("VERSION_CONFLICT");
        if (
          state.pilots.some(
            (pilot) => pilot.id !== id && pilot.employeeNumber === input.employeeNumber,
          )
        ) {
          throw new Error("员工号已存在");
        }
        const unit = state.pilots.find((pilot) => pilot.unitCode === input.unitCode);
        if (!unit) throw new Error("单位代码不存在或已停用");
        updated = {
          ...current,
          ...input,
          initials: Array.from(input.displayName.replace(/\s+/g, "")).slice(0, 2).join(""),
          unit: unit.unit,
          rankLabel: input.rankCode,
          active,
          version: current.version + 1,
        };
        return {
          ...state,
          pilots: state.pilots.map((pilot) => (pilot.id === id ? updated! : pilot)),
        };
      });
      return {
        data: toDetail(
          updated!,
          store.getSnapshot().reviews,
          store.getSnapshot().upgradePlans,
          fixedClock(clock),
          store.getSnapshot().qualificationConfigs,
        ),
        source: "mock",
      };
    },
    async previewImport(csvText, mode = "create_only") {
      const meta = (await pilots.getManagementMeta()).data;
      const parsed = parsePilotCsv(csvText, meta.qualifications);
      const state = store.getSnapshot();
      parsed.rows.forEach((row) => {
        if (
          mode === "create_only" &&
          state.pilots.some((pilot) => pilot.employeeNumber === row.input.employeeNumber)
        ) {
          row.errors.push("员工号已存在");
        }
        if (!meta.units.some((unit) => unit.code === row.input.unitCode)) {
          row.errors.push("单位代码不存在或已停用");
        }
        row.errors = [...new Set(row.errors)];
      });
      if (!parsed.rows.length && !parsed.fileErrors.length) {
        parsed.fileErrors.push("CSV 没有可导入的数据行");
      }
      const rows = parsed.rows.map((row) => ({
        rowNumber: row.rowNumber,
        employeeNumber: row.input.employeeNumber,
        displayName: row.input.displayName,
        qualificationCount: row.qualifications.length,
        errors: row.errors,
      }));
      const preview: PilotImportPreview = {
        total: rows.length,
        validCount: rows.filter((row) => !row.errors.length).length,
        errorCount: rows.filter((row) => row.errors.length > 0).length,
        createCount: rows.filter(
          (row) =>
            !row.errors.length &&
            !state.pilots.some((pilot) => pilot.employeeNumber === row.employeeNumber),
        ).length,
        updateCount: rows.filter(
          (row) =>
            !row.errors.length &&
            state.pilots.some((pilot) => pilot.employeeNumber === row.employeeNumber),
        ).length,
        fileErrors: parsed.fileErrors,
        rows,
      };
      return { data: preview, source: "mock" };
    },
    async importCsv(csvText, mode = "create_only", confirmMerge = false) {
      if (mode === "merge" && !confirmMerge) throw new Error("合并导入需要管理员二次确认");
      const preview = await pilots.previewImport(csvText, mode);
      if (preview.data.fileErrors.length || !preview.data.validCount) {
        throw new Error(
          preview.data.fileErrors[0] ??
            preview.data.rows.find((row) => row.errors.length)?.errors[0] ??
            "CSV 没有可导入的数据行",
        );
      }
      const meta = (await pilots.getManagementMeta()).data;
      const parsed = parsePilotCsv(csvText, meta.qualifications);
      const invalidEmployeeNumbers = new Set(
        preview.data.rows.filter((row) => row.errors.length > 0).map((row) => row.employeeNumber),
      );
      const validRows = parsed.rows.filter(
        (row) => !invalidEmployeeNumbers.has(row.input.employeeNumber) && !row.errors.length,
      );
      const createdIds: string[] = [];
      let qualificationCount = 0;
      let updatedCount = 0;
      let createdCount = 0;
      store.update((state) => {
        const created = validRows.map((row) => {
          const unit = state.pilots.find((pilot) => pilot.unitCode === row.input.unitCode)!;
          const existing =
            mode === "merge"
              ? state.pilots.find((pilot) => pilot.employeeNumber === row.input.employeeNumber)
              : undefined;
          const qualifications = row.qualifications.map((qualification) => ({
            id:
              state.qualificationConfigs.find(
                (config) => config.code === qualification.qualificationCode,
              )?.qualificationId ?? qualification.qualificationCode,
            validityRule: state.qualificationConfigs.find(
              (config) => config.code === qualification.qualificationCode,
            )?.validityRule,
            name: qualification.qualificationName,
            translations: qualification.qualificationTranslations,
            parameter: qualification.levelOrParameter,
            expiresOn: qualification.expiryDate,
            credentialNumber: "",
            issueDate: qualification.issueDate,
            expiryDate: qualification.expiryDate,
            issuingAuthority: "CSV 批量导入",
            levelOrParameter: qualification.levelOrParameter,
            lastVerifiedOn: mutationTime(clock),
          }));
          const pilot: AdminPilotEntity = {
            id: existing?.id ?? idGenerator.next("pilot"),
            employeeNumber: row.input.employeeNumber,
            displayName: row.input.displayName,
            initials: Array.from(row.input.displayName.replace(/\s+/g, "")).slice(0, 2).join(""),
            mobile: row.input.mobile,
            roleCode: row.input.roleCode,
            aircraftType: row.input.aircraftType,
            unit: unit.unit,
            unitCode: row.input.unitCode,
            rankLabel: row.input.rankCode,
            active: existing?.active ?? true,
            version: (existing?.version ?? 0) + 1,
            qualifications: existing
              ? [...existing.qualifications, ...qualifications]
              : qualifications,
            activeUpgradePlanId: null,
            electronicFiles: [],
          };
          if (existing) updatedCount += 1;
          else createdCount += 1;
          createdIds.push(pilot.id);
          qualificationCount += qualifications.length;
          return pilot;
        });
        return {
          ...state,
          pilots:
            mode === "merge"
              ? state.pilots
                  .map((pilot) => created.find((item) => item.id === pilot.id) ?? pilot)
                  .concat(
                    created.filter((item) => !state.pilots.some((pilot) => pilot.id === item.id)),
                  )
              : [...state.pilots, ...created],
        };
      });
      return {
        data: {
          createdCount,
          updatedCount,
          skippedCount: preview.data.errorCount,
          qualificationCount,
          pilotIds: createdIds,
        },
        source: "mock",
      };
    },
    async updateQualificationRecord(pilotId, qualificationId, rawInput) {
      const validation = adminQualificationRecordUpdateSchema.safeParse(rawInput);
      if (!validation.success) {
        throw new Error(validation.error.issues[0]?.message ?? "资质字段无效");
      }
      const input = validation.data;
      let result: AdminEditableQualificationRecord | null = null;
      store.update((state) => {
        const pilot = state.pilots.find((item) => item.id === pilotId);
        if (!pilot) throw new Error("未找到飞行员");
        const config = state.qualificationConfigs.find(
          (item) => item.core && item.qualificationId === qualificationId,
        );
        if (!config) throw new Error("未找到核心资质配置");
        const ruleValidation = validateQualificationRuleFields(
          {
            issueDate: input.issueDate,
            trainingDate: input.trainingDate ?? null,
            expiryDate: input.expiryDate || null,
            levelOrParameter: input.levelOrParameter,
          },
          config.validityRule,
          config.parameterRestriction,
        );
        if (ruleValidation.errors.length) throw new Error(ruleValidation.errors[0]!.message);
        const record = pilot.qualifications.find((item) => item.id === qualificationId);
        if (!record) throw new Error("生效资质记录不存在");
        const currentVersion = record.version ?? 1;
        if (input.expectedVersion !== currentVersion) {
          throw new Error("VERSION_CONFLICT");
        }
        const before = {
          credentialNumber: record.credentialNumber,
          issueDate: record.issueDate,
          expiryDate: record.expiryDate,
          issuingAuthority: record.issuingAuthority,
          levelOrParameter: record.levelOrParameter,
        };
        const after = {
          credentialNumber: input.credentialNumber,
          issueDate: input.issueDate,
          expiryDate: ruleValidation.expiryDate ?? "",
          issuingAuthority: input.issuingAuthority,
          levelOrParameter: input.levelOrParameter,
        };
        const changedFields = (Object.keys(after) as Array<keyof typeof after>).filter(
          (field) => before[field] !== after[field],
        );
        const lastVerifiedOn = format(clock.now(), "yyyy-MM-dd");
        const updated = {
          ...record,
          credentialNumber: input.credentialNumber,
          issueDate: input.issueDate,
          expiryDate: ruleValidation.expiryDate ?? "",
          expiresOn: ruleValidation.expiryDate ?? "",
          validityRule: config.validityRule,
          issuingAuthority: input.issuingAuthority,
          levelOrParameter: input.levelOrParameter,
          parameter: input.levelOrParameter,
          lastVerifiedOn,
          version: currentVersion + 1,
          audit: [
            ...(record.audit ?? []),
            {
              id: idGenerator.next("AUD"),
              action: "qualification.admin_updated",
              actor: "演示管理员",
              occurredAt: mutationTime(clock),
              detail: JSON.stringify({ qualificationId, changedFields, before, after }),
            },
          ],
        };
        result = {
          ...evaluateQualification({
            record: { expiryDate: updated.expiresOn, validityRule: config.validityRule },
            clock,
            timezone: "Asia/Shanghai",
          }),
          recordId: `qualification:${pilotId}:${qualificationId}`,
          qualificationId,
          qualificationName: updated.name,
          qualificationTranslations: updated.translations,
          credentialNumber: updated.credentialNumber,
          issueDate: updated.issueDate,
          expiryDate: updated.expiryDate,
          issuingAuthority: updated.issuingAuthority,
          levelOrParameter: updated.levelOrParameter,
          lastVerifiedOn: updated.lastVerifiedOn,
          version: updated.version,
        };
        return {
          ...state,
          pilots: state.pilots.map((item) =>
            item.id !== pilotId
              ? item
              : {
                  ...item,
                  qualifications: item.qualifications.map((qualification) =>
                    qualification.id === qualificationId ? updated : qualification,
                  ),
                },
          ),
        };
      });
      return { data: copy(result!), source: "mock" };
    },
    async createQualificationRecord(
      pilotId,
      qualificationId,
      input: AdminQualificationRecordCreateInput,
    ) {
      const validation = adminQualificationRecordCreateSchema.safeParse(input);
      if (!validation.success) {
        throw new Error(validation.error.issues[0]?.message ?? "资质字段无效");
      }
      let result: AdminEditableQualificationRecord | null = null;
      store.update((state) => {
        const pilot = state.pilots.find((item) => item.id === pilotId);
        if (!pilot) throw new Error("未找到飞行员");
        if (pilot.qualifications.some((item) => item.id === qualificationId)) {
          throw new Error("该资质已经存在");
        }
        const config = state.qualificationConfigs.find(
          (item) => item.core && item.qualificationId === qualificationId,
        );
        if (!config) throw new Error("未找到核心资质配置");
        const ruleValidation = validateQualificationRuleFields(
          {
            issueDate: validation.data.issueDate,
            trainingDate: validation.data.trainingDate ?? null,
            expiryDate: validation.data.expiryDate || null,
            levelOrParameter: validation.data.levelOrParameter,
          },
          config.validityRule,
          config.parameterRestriction,
        );
        if (ruleValidation.errors.length) throw new Error(ruleValidation.errors[0]!.message);
        const created = {
          id: qualificationId,
          name: config.name,
          credentialNumber: validation.data.credentialNumber,
          issueDate: validation.data.issueDate,
          expiryDate: ruleValidation.expiryDate ?? "",
          expiresOn: ruleValidation.expiryDate ?? "",
          validityRule: config.validityRule,
          issuingAuthority: validation.data.issuingAuthority,
          levelOrParameter: validation.data.levelOrParameter,
          parameter: validation.data.levelOrParameter,
          lastVerifiedOn: format(clock.now(), "yyyy-MM-dd"),
          version: 1,
          audit: [
            {
              id: idGenerator.next("AUD"),
              action: "qualification.admin_created",
              actor: administrator,
              occurredAt: mutationTime(clock),
              detail: JSON.stringify({ qualificationId }),
            },
          ],
        };
        result = {
          ...evaluateQualification({
            record: { expiryDate: created.expiresOn, validityRule: config.validityRule },
            clock,
            timezone: "Asia/Shanghai",
          }),
          recordId: `qualification:${pilotId}:${qualificationId}`,
          qualificationId,
          qualificationName: created.name,
          qualificationTranslations: config.translations,
          credentialNumber: created.credentialNumber,
          issueDate: created.issueDate,
          expiryDate: created.expiryDate,
          issuingAuthority: created.issuingAuthority,
          levelOrParameter: created.levelOrParameter,
          lastVerifiedOn: created.lastVerifiedOn,
          version: created.version,
        };
        return {
          ...state,
          pilots: state.pilots.map((item) =>
            item.id === pilotId
              ? { ...item, qualifications: [...item.qualifications, created] }
              : item,
          ),
        };
      });
      return { data: copy(result!), source: "mock" };
    },
  };

  const reviews: ReviewService = {
    async list(query: ReviewListQuery) {
      const q = query.q?.trim().toLocaleLowerCase() ?? "";
      const items = store
        .getSnapshot()
        .reviews.filter(
          (review) =>
            (!q ||
              review.pilotName.toLocaleLowerCase().includes(q) ||
              review.employeeNumber.toLocaleLowerCase().includes(q) ||
              review.qualificationName.toLocaleLowerCase().includes(q)) &&
            (!query.status || query.status === "all" || review.humanStatus === query.status) &&
            (!query.ai || query.ai === "all" || review.aiStatus === query.ai),
        )
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      return { data: paginate(copy(items), query.page, query.pageSize), source: "mock" };
    },
    async getById(id) {
      const review = store.getSnapshot().reviews.find((item) => item.id === id);
      return { data: review ? copy(review) : null, source: "mock" };
    },
    async correct(id, input) {
      const validation = qualificationUpdateSchema.safeParse(input);
      if (!validation.success) {
        throw new Error(validation.error.issues[0]?.message ?? "人工纠正字段无效");
      }
      let result: QualificationReview | null = null;
      store.update((state) => {
        const review = findPendingReview(state, id);
        const config = state.qualificationConfigs.find(
          (item) => (item.qualificationId ?? item.id) === review.qualificationId,
        );
        if (!config) throw new Error("未找到资质配置");
        const ruleValidation = validateQualificationRuleFields(
          {
            issueDate: validation.data.issueDate,
            trainingDate: validation.data.trainingDate ?? null,
            expiryDate: validation.data.expiryDate || null,
            levelOrParameter: validation.data.levelOrParameter,
          },
          config.validityRule,
          config.parameterRestriction,
        );
        if (ruleValidation.errors.length) throw new Error(ruleValidation.errors[0]!.message);
        const validatedData = {
          ...validation.data,
          expiryDate: ruleValidation.expiryDate ?? "",
        };
        const fields = Object.keys(review.submittedFields) as ReviewCredentialFieldName[];
        const corrections = fields.reduce<QualificationReview["corrections"]>((next, field) => {
          if (validatedData[field] !== review.submittedFields[field]) {
            next[field] = validatedData[field];
          }
          return next;
        }, {});
        const changedFields = fields.filter(
          (field) => corrections[field] !== review.corrections[field],
        );
        if (changedFields.length === 0) {
          result = review;
          return state;
        }
        const occurredAt = mutationTime(clock);
        const updated: QualificationReview = {
          ...review,
          corrections,
          fieldComparisons: review.fieldComparisons.map((field) => ({
            ...field,
            correctedValue: corrections[field.field],
          })),
          audit: [
            ...review.audit,
            {
              id: `${review.id}-correction-${review.audit.length}`,
              action: "corrected",
              actor: administrator,
              occurredAt,
              detail: `人工纠正字段：${changedFields.join("、")}`,
            },
          ],
        };
        result = updated;
        return {
          ...state,
          reviews: state.reviews.map((item) => (item.id === id ? updated : item)),
        };
      });
      return { data: copy(result!), source: "mock" };
    },
    async approve(id, input) {
      if (!input.confirmed) throw new Error("请先确认已核对凭证与提交信息");
      let result: QualificationReview | null = null;
      store.update((state) => {
        const review = findPendingReview(state, id);
        const occurredAt = mutationTime(clock);
        const effectiveFields = { ...review.submittedFields, ...review.corrections };
        const updated: QualificationReview = {
          ...review,
          humanStatus: "approved",
          decision: {
            kind: "approved",
            confirmed: true,
            note: input.note?.trim() || undefined,
            actor: administrator,
            occurredAt,
          },
          audit: [
            ...review.audit,
            {
              id: `${review.id}-approved`,
              action: "approved",
              actor: administrator,
              occurredAt,
              detail: input.note?.trim() ? `审核通过：${input.note.trim()}` : "审核通过",
            },
          ],
        };
        result = updated;
        return {
          ...state,
          reviews: state.reviews.map((item) => (item.id === id ? updated : item)),
          notificationLogs: [
            {
              id: idGenerator.next("NOT"),
              type: "review_approved",
              channel: "in_app",
              status: "queued",
              pilotId: review.pilotId,
              pilotName: review.pilotName,
              employeeNumber: review.employeeNumber,
              target: "飞行员本人（脱敏目标）",
              summary: `人工审核通过：${review.qualificationName}`,
              message: `【审核通过｜Mock 演示】管理员人工终审确认“${review.qualificationName}”通过。`,
              createdAt: occurredAt,
              attempts: [],
              mock: true,
            },
            ...state.notificationLogs,
          ],
          pilots: state.pilots.map((pilot) =>
            pilot.id !== review.pilotId
              ? pilot
              : {
                  ...pilot,
                  qualifications: pilot.qualifications.map((qualification) =>
                    qualification.id !== review.qualificationId
                      ? qualification
                      : {
                          ...qualification,
                          ...effectiveFields,
                          expiresOn: effectiveFields.expiryDate,
                          lastVerifiedOn: occurredAt.slice(0, 10),
                        },
                  ),
                },
          ),
        };
      });
      return { data: copy(result!), source: "mock" };
    },
    async returnForChanges(id, input) {
      const reason = input.reason.trim();
      if (reason.length < 5) throw new Error("退回原因至少需要 5 个字符");
      let result: QualificationReview | null = null;
      store.update((state) => {
        const review = findPendingReview(state, id);
        const occurredAt = mutationTime(clock);
        const updated: QualificationReview = {
          ...review,
          humanStatus: "returned",
          decision: { kind: "returned", reason, actor: administrator, occurredAt },
          audit: [
            ...review.audit,
            {
              id: `${review.id}-returned`,
              action: "returned",
              actor: administrator,
              occurredAt,
              detail: `退回修改：${reason}`,
            },
          ],
        };
        result = updated;
        return {
          ...state,
          reviews: state.reviews.map((item) => (item.id === id ? updated : item)),
          notificationLogs: [
            {
              id: idGenerator.next("NOT"),
              type: "review_returned",
              channel: "in_app",
              status: "queued",
              pilotId: review.pilotId,
              pilotName: review.pilotName,
              employeeNumber: review.employeeNumber,
              target: "飞行员本人（脱敏目标）",
              summary: `人工审核退回：${review.qualificationName}`,
              message: `【审核退回｜Mock 演示】AI 标记异常并进入人工复核；管理员决定退回。原因：${reason}`,
              createdAt: occurredAt,
              attempts: [],
              mock: true,
            },
            ...state.notificationLogs,
          ],
        };
      });
      return { data: copy(result!), source: "mock" };
    },
    async listForPreview() {
      return {
        data: store
          .getSnapshot()
          .reviews.slice(0, 2)
          .map((review) => ({
            id: review.id,
            subject: review.pilotName,
            qualification: review.qualificationName,
            status:
              review.aiStatus === "matched" ? ("matched" as const) : ("needs-review" as const),
          })),
        source: "mock",
      };
    },
  };

  const dashboard: AdminDashboardService = {
    async getSummary() {
      const state = store.getSnapshot();
      const capturedClock = fixedClock(clock);
      const qualifications = state.pilots.flatMap((pilot) =>
        mockMemberQualificationRecords(pilot, state.qualificationConfigs, capturedClock).map(
          (record) => ({
            pilot,
            qualification: deriveQualification(record, capturedClock),
            dateState: evaluateQualification({
              record:
                record.recordExists === false
                  ? null
                  : { expiryDate: record.expiresOn, validityRule: record.validityRule },
              timezone: record.timezone,
              clock: capturedClock,
            }),
          }),
        ),
      );
      const week = {
        start: startOfWeek(clock.now(), { weekStartsOn: 1 }),
        end: endOfWeek(clock.now(), { weekStartsOn: 1 }),
      };
      const weeklyUpgrades = state.pilots.flatMap((pilot) => {
        const plan = activePlanFor(pilot, state.upgradePlans);
        return (plan?.stages ?? [])
          .filter((stage) => isWithinInterval(parseISO(stage.plannedStart), week))
          .map((stage) => ({
            planId: plan!.id,
            pilotId: pilot.id,
            pilotName: pilot.displayName,
            role: pilotRoleLabel(pilot.roleCode),
            planTitle: plan!.title,
            stage,
          }));
      });
      const delayedUpgrades = state.upgradePlans.flatMap((plan) => {
        const pilot = state.pilots.find((item) => item.id === plan.pilotId);
        if (!pilot || plan.lifecycleStatus === "cancelled") return [];
        return plan.stages
          .filter((stage) => stage.status === "delayed" || (stage.delayDays ?? 0) > 0)
          .map((stage) => ({
            planId: plan.id,
            pilotId: pilot.id,
            pilotName: pilot.displayName,
            role: pilotRoleLabel(pilot.roleCode),
            planTitle: plan.title,
            stage,
          }));
      });
      const summary: AdminDashboardSummary = {
        timezones: ["Asia/Shanghai"],
        evaluatedAt: capturedClock.now().toISOString(),
        missingCount: qualifications.filter(
          (item) => item.qualification.required && item.dateState.status === "missing",
        ).length,
        incompleteCount: qualifications.filter(
          (item) => item.qualification.required && item.dateState.status === "incomplete",
        ).length,
        expiredCount: qualifications.filter((item) => item.dateState.status === "expired").length,
        dueIn7DaysCount: qualifications.filter((item) => item.dateState.window === "due_7").length,
        dueIn30DaysCount: qualifications.filter(
          (item) => item.dateState.window === "due_7" || item.dateState.window === "due_30",
        ).length,
        pendingReviewCount: state.reviews.filter((review) => review.humanStatus === "pending")
          .length,
        weeklyUpgradeCount: weeklyUpgrades.length,
        delayedUpgradeCount: delayedUpgrades.length,
        pendingReviews: copy(
          state.reviews
            .filter((review) => review.humanStatus === "pending")
            .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
        ),
        qualificationAlerts: qualifications
          .filter(
            (item) => item.dateState.status === "expired" || item.dateState.status === "due_30",
          )
          .flatMap((item) =>
            typeof item.dateState.daysRemaining === "number"
              ? [{ ...item, daysRemaining: item.dateState.daysRemaining }]
              : [],
          )
          .sort((a, b) => a.daysRemaining - b.daysRemaining)
          .map((item) => ({
            pilotId: item.pilot.id,
            pilotName: item.pilot.displayName,
            qualification: item.qualification,
            daysRemaining: item.daysRemaining,
          })),
        weeklyUpgrades: copy(weeklyUpgrades),
        delayedUpgrades: copy(delayedUpgrades),
      };
      return { data: summary, source: "mock" };
    },
  };

  return { dashboard, pilots, reviews };
}

export const mockAdminServices = createMockAdminServices();
