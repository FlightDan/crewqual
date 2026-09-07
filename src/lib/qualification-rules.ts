import { z } from "zod";
import { databaseDateOnly, qualificationDaysRemaining } from "@/lib/date-only";
import type { Prisma } from "@/generated/prisma/client";
import { canEvaluateLinearRegex, compileLinearRegex, testLinearRegex } from "@/lib/regex-safety";

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期必须为 YYYY-MM-DD")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, "日期无效");

export const validityRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("fixed_months"),
    baseDateField: z.enum(["issueDate", "trainingDate"]),
    months: z.number().int().min(1).max(120),
  }),
  z.object({ kind: z.literal("manual_expiry") }),
  z.object({ kind: z.literal("non_expiring") }),
]);

export const reminderRuleSchema = z
  .object({
    firstDays: z.number().int().min(1).max(365),
    secondDays: z.number().int().min(1).max(365),
    dueRecipients: z
      .array(z.enum(["PERSON", "ADMIN", "SUPER_ADMIN"]))
      .max(3)
      .default(["PERSON"]),
    expiredRecipients: z
      .array(z.enum(["PERSON", "ADMIN", "SUPER_ADMIN"]))
      .max(3)
      .default(["PERSON"]),
  })
  .refine((value) => value.firstDays > value.secondDays, {
    message: "首次提醒天数必须大于再次提醒天数",
    path: ["firstDays"],
  });

export const parameterRestrictionSchema = z
  .object({
    enabled: z.boolean(),
    description: z.string(),
    version: z.literal(1).default(1),
    enforcement: z
      .object({
        mode: z.enum(["none", "allowed_values", "regex"]),
        allowedValues: z.array(z.string().trim().min(1)).max(100).default([]),
        pattern: z.string().max(256).default(""),
      })
      .strict()
      .default({ mode: "none", allowedValues: [], pattern: "" }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.enforcement.mode === "allowed_values" && !value.enforcement.allowedValues.length) {
      context.addIssue({
        code: "custom",
        path: ["enforcement", "allowedValues"],
        message: "允许值列表不能为空",
      });
    }
    if (value.enforcement.mode === "regex") {
      if (!value.enforcement.pattern) {
        context.addIssue({
          code: "custom",
          path: ["enforcement", "pattern"],
          message: "正则表达式不能为空",
        });
      } else {
        // This shared schema is also used by the client form. The server is
        // authoritative for regex compilation; the browser mapping excludes
        // the RE2 WASM engine from the client bundle, while server saves and matches
        // both use compileLinearRegex/testLinearRegex below.
        if (typeof window === "undefined" || process.env.NODE_ENV === "test") {
          try {
            compileLinearRegex(value.enforcement.pattern);
          } catch (error) {
            context.addIssue({
              code: "custom",
              path: ["enforcement", "pattern"],
              message: error instanceof Error ? error.message : "正则表达式无效",
            });
          }
        }
      }
    }
  });

export const ocrChecksSchema = z
  .object({
    enabled: z.boolean(),
    credentialNumber: z.boolean(),
    holderMatch: z.boolean(),
    expiryDate: z.boolean(),
    issuingAuthoritySeal: z.boolean(),
  })
  .strict();

export const qualificationRuleSnapshotSchema = z
  .object({
    snapshotSource: z
      .enum(["captured", "inferred_backfill", "reviewer_confirmed"])
      .default("captured"),
    version: z.number().int().positive(),
    validityRule: validityRuleSchema,
    reminders: reminderRuleSchema,
    parameterRestriction: parameterRestrictionSchema,
    ocrChecks: ocrChecksSchema,
  })
  .strict();

export type QualificationValidityRule = z.infer<typeof validityRuleSchema>;
export type QualificationReminderRule = z.infer<typeof reminderRuleSchema>;
export type QualificationParameterRestriction = z.infer<typeof parameterRestrictionSchema>;
export type QualificationRuleSnapshot = z.infer<typeof qualificationRuleSnapshotSchema>;

/** Expiry interpretation depends on captured validity evidence, not mutable notification/OCR settings. */
export const qualificationValiditySnapshotSchema = qualificationRuleSnapshotSchema
  .pick({ snapshotSource: true, version: true, validityRule: true })
  .passthrough();

export function qualificationRuleSnapshot(type: {
  version: number;
  validityRule: unknown;
  reminders: unknown;
  parameterRestriction: unknown;
  ocrChecks: unknown;
}) {
  const parsed = qualificationRuleSnapshotSchema.safeParse({
    snapshotSource: "captured",
    version: type.version,
    validityRule: type.validityRule,
    reminders: type.reminders,
    parameterRestriction: type.parameterRestriction,
    ocrChecks: type.ocrChecks,
  });
  if (!parsed.success) throw new Error("资质规则快照配置无效");
  return parsed.data as Prisma.InputJsonObject;
}

export function parseQualificationRuleSnapshot(value: unknown): QualificationRuleSnapshot {
  const parsed = qualificationRuleSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new Error("资质规则快照缺失或无效");
  return parsed.data;
}

export type QualificationRuleFields = {
  issueDate: string;
  expiryDate: string | null | undefined;
  trainingDate?: string | null;
  levelOrParameter?: string;
};

export type QualificationRuleError = {
  field: "issueDate" | "expiryDate" | "trainingDate" | "levelOrParameter";
  message: string;
};

export function parseValidityRule(value: unknown): QualificationValidityRule {
  const parsed = validityRuleSchema.safeParse(value);
  if (!parsed.success) throw new Error("资质有效期规则配置无效");
  return parsed.data;
}

export function parseReminderRule(value: unknown): QualificationReminderRule {
  const parsed = reminderRuleSchema.safeParse(value);
  if (!parsed.success) {
    return {
      firstDays: 90,
      secondDays: 30,
      dueRecipients: ["PERSON"],
      expiredRecipients: ["PERSON"],
    };
  }
  return parsed.data;
}

function parseDate(value: string) {
  const parsed = dateOnlySchema.safeParse(value);
  return parsed.success ? value : null;
}

function addMonthsToDate(value: string, months: number) {
  const [year, month, day] = value.split("-").map(Number);
  const targetMonthIndex = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export function calculateExpectedExpiry(
  fields: Pick<QualificationRuleFields, "issueDate" | "trainingDate">,
  rule: QualificationValidityRule,
) {
  if (rule.kind !== "fixed_months") return null;
  const baseDate = rule.baseDateField === "issueDate" ? fields.issueDate : fields.trainingDate;
  if (!baseDate || !parseDate(baseDate)) return null;
  return addMonthsToDate(baseDate, rule.months);
}

/**
 * Validate and normalize the final business fields. Every server write path
 * should call this instead of implementing a local expiry check.
 */
export function validateQualificationRuleFields(
  fields: QualificationRuleFields,
  rule: QualificationValidityRule,
  rawParameterRestriction?: unknown,
): { expiryDate: string | null; errors: QualificationRuleError[] } {
  const errors: QualificationRuleError[] = [];
  if (!parseDate(fields.issueDate)) errors.push({ field: "issueDate", message: "签发日期无效" });
  if (fields.trainingDate && !parseDate(fields.trainingDate)) {
    errors.push({ field: "trainingDate", message: "培训日期无效" });
  }
  if (rawParameterRestriction !== undefined) {
    const restriction = parameterRestrictionSchema.safeParse(rawParameterRestriction);
    if (!restriction.success) {
      errors.push({ field: "levelOrParameter", message: "等级/参数规则配置无效" });
    } else if (restriction.data.enabled && restriction.data.enforcement.mode !== "none") {
      const value = fields.levelOrParameter?.trim() ?? "";
      const enforcement = restriction.data.enforcement;
      if (enforcement.mode === "allowed_values" && !enforcement.allowedValues.includes(value)) {
        errors.push({
          field: "levelOrParameter",
          message: `等级/参数必须是：${enforcement.allowedValues.join("、")}`,
        });
      }
      if (enforcement.mode === "regex" && canEvaluateLinearRegex()) {
        try {
          if (!testLinearRegex(enforcement.pattern, value)) {
            errors.push({ field: "levelOrParameter", message: "等级/参数格式不符合规则" });
          }
        } catch {
          errors.push({ field: "levelOrParameter", message: "等级/参数规则配置无效" });
        }
      }
    }
  }

  const suppliedExpiryDate = fields.expiryDate ?? "";
  let normalizedExpiryDate = suppliedExpiryDate;
  if (rule.kind === "non_expiring") {
    if (suppliedExpiryDate)
      errors.push({ field: "expiryDate", message: "长期有效资质不能填写到期日期" });
    return { expiryDate: null, errors };
  }
  if (rule.kind === "manual_expiry") {
    if (!suppliedExpiryDate) errors.push({ field: "expiryDate", message: "请填写到期日期" });
    else if (!parseDate(suppliedExpiryDate))
      errors.push({ field: "expiryDate", message: "到期日期无效" });
  }
  if (rule.kind === "fixed_months") {
    if (rule.baseDateField === "trainingDate" && !fields.trainingDate) {
      errors.push({ field: "trainingDate", message: "该资质需要培训日期" });
    }
    const expected = calculateExpectedExpiry(fields, rule);
    if (!expected) {
      if (!errors.some((error) => error.field === "trainingDate")) {
        errors.push({ field: "issueDate", message: "无法计算资质到期日期" });
      }
    } else if (suppliedExpiryDate && suppliedExpiryDate !== expected) {
      errors.push({ field: "expiryDate", message: `按规则到期日期应为 ${expected}` });
    }
    if (expected) normalizedExpiryDate = expected;
  }
  if (
    normalizedExpiryDate &&
    parseDate(normalizedExpiryDate) &&
    parseDate(fields.issueDate) &&
    normalizedExpiryDate < fields.issueDate
  ) {
    errors.push({ field: "expiryDate", message: "到期日期不得早于签发日期" });
  }
  return { expiryDate: normalizedExpiryDate || null, errors };
}

export function reminderWindow(
  expiryDate: Date,
  now: Date,
  reminders: unknown,
  timezone = "Asia/Shanghai",
) {
  const configured = parseReminderRule(reminders);
  const daysRemaining = qualificationDaysRemaining(databaseDateOnly(expiryDate)!, now, timezone);
  if (daysRemaining < 0) return { daysRemaining, kind: "expired" as const };
  if (daysRemaining === 0) return { daysRemaining, kind: "today" as const };
  if (daysRemaining <= configured.secondDays) return { daysRemaining, kind: "second" as const };
  if (daysRemaining <= configured.firstDays) return { daysRemaining, kind: "first" as const };
  return null;
}
