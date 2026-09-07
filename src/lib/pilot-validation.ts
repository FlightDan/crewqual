import { z } from "zod";
import { isMatch, isValid, parseISO } from "date-fns";
import type {
  DateFieldName,
  DateFieldSource,
  QualificationParameterRestriction,
  QualificationUpdateDraft,
} from "@/types/services";
import type { ValidityRule } from "@/types/services";
import { validateQualificationRuleFields } from "@/lib/qualification-rules";

export const identitySchema = z.object({
  employeeNumber: z.string().trim().min(1, "请输入员工工号"),
  mobile: z.string().regex(/^\d{11}$/, "请输入11位数字手机号"),
});

const isoDate = z
  .string()
  .refine(
    (value) => isMatch(value, "yyyy-MM-dd") && isValid(parseISO(value)),
    "请输入有效日期，格式为 YYYY-MM-DD",
  );

const qualificationFieldsSchema = z.object({
  credentialNumber: z.string().trim().min(1, "请输入证件编号"),
  issueDate: isoDate,
  trainingDate: z.union([isoDate, z.literal("")]),
  expiryDate: z.union([isoDate, z.literal("")]),
  issuingAuthority: z.string().trim().min(1, "请输入签发机构"),
  levelOrParameter: z.string().trim().min(1, "请输入等级/参数"),
});

export function createQualificationUpdateSchema(
  validityRule: ValidityRule = { kind: "manual_expiry" },
  parameterRestriction?: QualificationParameterRestriction,
) {
  return qualificationFieldsSchema.superRefine((value, context) => {
    const validation = validateQualificationRuleFields(
      {
        issueDate: value.issueDate,
        trainingDate: value.trainingDate || null,
        expiryDate: value.expiryDate || null,
        levelOrParameter: value.levelOrParameter,
      },
      validityRule,
      parameterRestriction,
    );
    validation.errors.forEach((error) =>
      context.addIssue({ code: "custom", path: [error.field], message: error.message }),
    );
  });
}

export const qualificationUpdateSchema = createQualificationUpdateSchema();

export type QualificationFormValues = z.infer<typeof qualificationUpdateSchema>;

export function createEmptyDraft(
  qualificationId: QualificationUpdateDraft["qualificationId"],
): QualificationUpdateDraft {
  return {
    qualificationId,
    evidenceId: "",
    documentName: "",
    documentType: "",
    documentSize: 0,
    documentPreviewUrl: "",
    credentialNumber: "",
    issueDate: "",
    trainingDate: "",
    expiryDate: "",
    issuingAuthority: "",
    levelOrParameter: "",
    dateSources: {},
  };
}

export function applyRecognizedDates(
  draft: QualificationUpdateDraft,
  dates: Partial<Record<DateFieldName, string>>,
): QualificationUpdateDraft {
  const next = { ...draft, dateSources: { ...draft.dateSources } };
  for (const field of ["issueDate", "expiryDate"] as const) {
    if (!next[field] && dates[field]) {
      next[field] = dates[field]!;
      next.dateSources[field] = "ai";
    }
  }
  return next;
}

export function sourceAfterDateChange(
  previousValue: string,
  nextValue: string,
  previousSource?: DateFieldSource,
): DateFieldSource {
  if (previousSource === "ai" && previousValue !== nextValue) return "manual_modified";
  if (previousSource === "manual_modified") return "manual_modified";
  return "manual";
}

export function isDraftSubmittable(
  draft: QualificationUpdateDraft,
  validityRule: ValidityRule = { kind: "manual_expiry" },
  parameterRestriction?: QualificationParameterRestriction,
): boolean {
  return (
    Boolean(draft.evidenceId || draft.documentName) &&
    createQualificationUpdateSchema(validityRule, parameterRestriction).safeParse(draft).success
  );
}
