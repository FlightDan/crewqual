import type {
  Clock,
  Qualification,
  QualificationDateState,
  QualificationRecord,
  QualificationSection,
  QualificationStatus,
} from "@/types/services";
import {
  DEFAULT_BUSINESS_TIMEZONE,
  databaseDateOnly,
  isValidTimezone,
  qualificationDaysRemaining,
} from "@/lib/date-only";
import { qualificationValiditySnapshotSchema, validityRuleSchema } from "@/lib/qualification-rules";

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(clock: Clock = systemClock): Clock {
  const now = clock.now();
  return { now: () => now };
}

function unavailableState(
  status: "missing" | "incomplete",
  reason: string,
): QualificationDateState {
  const label = status === "missing" ? "缺少资质记录" : "数据不完整";
  return {
    status,
    window: status,
    daysRemaining: null,
    statusLabel: label,
    remainingLabel: status === "missing" ? "请提交资质材料" : "请联系管理员核查",
    statusReason: reason,
  };
}

/** Date projection only. A blank date is not proof of a non-expiring credential. */
export function deriveQualificationDateState(
  expiresOn: string,
  clock: Clock = systemClock,
  timezone: string = DEFAULT_BUSINESS_TIMEZONE,
): QualificationDateState {
  if (!expiresOn) return unavailableState("incomplete", "missing_expiry");
  const daysRemaining = qualificationDaysRemaining(expiresOn, clock.now(), timezone);
  const status: QualificationStatus =
    daysRemaining < 0
      ? "expired"
      : daysRemaining <= 30
        ? "due_30"
        : daysRemaining <= 90
          ? "due_90"
          : "valid";
  const window =
    daysRemaining < 0
      ? "expired"
      : daysRemaining <= 7
        ? "due_7"
        : daysRemaining <= 30
          ? "due_30"
          : daysRemaining <= 90
            ? "due_90"
            : "valid";
  const absoluteDays = Math.abs(daysRemaining);
  return {
    status,
    window,
    daysRemaining,
    statusLabel:
      daysRemaining < 0
        ? `已过期 ${absoluteDays}天`
        : daysRemaining === 0
          ? "今日到期"
          : daysRemaining <= 90
            ? `剩余 ${daysRemaining}天`
            : "有效",
    remainingLabel:
      daysRemaining < 0
        ? `已逾期 ${absoluteDays} 天`
        : daysRemaining === 0
          ? "今日到期"
          : `剩余 ${daysRemaining} 天`,
    statusReason: "expiry_date",
  };
}

export type QualificationStateRecord = {
  expiryDate: Date | string | null | undefined;
  validityRule: unknown;
  snapshotSource?: "captured" | "reviewer_confirmed" | "inferred_backfill";
};

/** Shared domain decision for display, eligibility and notification routing. */
export function evaluateQualification(input: {
  record: QualificationStateRecord | null | undefined;
  timezone: string | null | undefined;
  clock?: Clock;
}): QualificationDateState {
  if (!input.record) return unavailableState("missing", "missing_record");
  if (!isValidTimezone(input.timezone)) return unavailableState("incomplete", "invalid_timezone");
  const rule = validityRuleSchema.safeParse(input.record.validityRule);
  if (!rule.success) return unavailableState("incomplete", "invalid_rule");
  if (input.record.snapshotSource === "inferred_backfill") {
    return unavailableState("incomplete", "unverified_rule");
  }
  const expiresOn = databaseDateOnly(input.record.expiryDate);
  if (rule.data.kind === "non_expiring") {
    if (expiresOn) return unavailableState("incomplete", "unexpected_expiry");
    return {
      status: "valid",
      window: "valid",
      daysRemaining: null,
      statusLabel: "长期有效",
      remainingLabel: "长期有效",
      statusReason: "non_expiring",
    };
  }
  if (!expiresOn) return unavailableState("incomplete", "missing_expiry");
  try {
    return deriveQualificationDateState(expiresOn, input.clock, input.timezone);
  } catch {
    return unavailableState("incomplete", "invalid_expiry");
  }
}

export type StoredQualificationStateRecord = {
  expiryDate: Date | string | null;
  qualificationRuleSnapshot: unknown;
};

/** Authoritative reads use the saved rule evidence, not the current type configuration. */
export function evaluateStoredQualification(
  record: StoredQualificationStateRecord | null | undefined,
  clock: Clock = systemClock,
  timezone: string | null | undefined = DEFAULT_BUSINESS_TIMEZONE,
): QualificationDateState {
  if (!record) return unavailableState("missing", "missing_record");
  const snapshot = qualificationValiditySnapshotSchema.safeParse(record.qualificationRuleSnapshot);
  return evaluateQualification({
    record: {
      expiryDate: record.expiryDate,
      validityRule: snapshot.success ? snapshot.data.validityRule : undefined,
      snapshotSource: snapshot.success ? snapshot.data.snapshotSource : undefined,
    },
    timezone,
    clock,
  });
}

export function deriveQualification(
  record: QualificationRecord,
  clock: Clock = systemClock,
): Qualification {
  const timezone = record.timezone === undefined ? DEFAULT_BUSINESS_TIMEZONE : record.timezone;
  const state =
    record.recordExists === false || record.validityRule || !record.expiresOn || !timezone
      ? evaluateQualification({
          record:
            record.recordExists === false
              ? null
              : { expiryDate: record.expiresOn, validityRule: record.validityRule },
          timezone,
          clock,
        })
      : deriveQualificationDateState(record.expiresOn, clock, timezone);
  return { ...record, ...state };
}

export const qualificationSectionDefinitions: Array<
  Pick<QualificationSection, "status" | "title">
> = [
  { status: "missing", title: "需要补充（缺少资质）" },
  { status: "incomplete", title: "需要人工核查（数据不完整）" },
  { status: "expired", title: "需要紧急处理（已过期）" },
  { status: "due_30", title: "即将到期（30天内）" },
  { status: "due_90", title: "正常跟进（90天内）" },
  { status: "valid", title: "正常运行中" },
];

export function groupQualificationsByStatus(
  records: QualificationRecord[],
  clock: Clock = systemClock,
): QualificationSection[] {
  const capturedClock = fixedClock(clock);
  const qualifications = records.map((record) => deriveQualification(record, capturedClock));
  return qualificationSectionDefinitions.map((section) => ({
    ...section,
    qualifications: qualifications.filter((item) => item.status === section.status),
  }));
}
