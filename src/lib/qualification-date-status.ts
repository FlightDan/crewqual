import type {
  Clock,
  Qualification,
  QualificationDateState,
  QualificationRecord,
  QualificationSection,
  QualificationStatus,
} from "@/types/services";

export const systemClock: Clock = { now: () => new Date() };

const DAY_MS = 24 * 60 * 60 * 1000;

function shanghaiDay(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
}

function dateOnlyDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return Number.NaN;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return Number.NaN;
  }
  return parsed.getTime();
}

export function deriveQualificationDateState(
  expiresOn: string,
  clock: Clock = systemClock,
): QualificationDateState {
  if (!expiresOn) {
    return {
      status: "valid",
      window: "valid",
      daysRemaining: Number.POSITIVE_INFINITY,
      statusLabel: "长期有效",
      remainingLabel: "长期有效",
    };
  }
  const expiryDay = dateOnlyDay(expiresOn);
  if (Number.isNaN(expiryDay)) throw new Error(`Invalid qualification expiry date: ${expiresOn}`);

  const daysRemaining = Math.round((expiryDay - shanghaiDay(clock.now())) / DAY_MS);
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
  };
}

export function deriveQualification(
  record: QualificationRecord,
  clock: Clock = systemClock,
): Qualification {
  return { ...record, ...deriveQualificationDateState(record.expiresOn, clock) };
}

const sectionDefinitions: Array<Pick<QualificationSection, "status" | "title">> = [
  { status: "expired", title: "需要紧急处理（已过期）" },
  { status: "due_30", title: "即将到期（30天内）" },
  { status: "due_90", title: "正常跟进（90天内）" },
  { status: "valid", title: "正常运行中" },
];

export function groupQualificationsByStatus(
  records: QualificationRecord[],
  clock: Clock = systemClock,
): QualificationSection[] {
  const qualifications = records.map((record) => deriveQualification(record, clock));
  return sectionDefinitions.map((section) => ({
    ...section,
    qualifications: qualifications.filter((item) => item.status === section.status),
  }));
}
