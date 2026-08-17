import { isMatch, isValid, parseISO } from "date-fns";
import { z } from "zod";
import { UPGRADE_STAGE_NAMES } from "@/types/services";
import {
  ocrChecksSchema,
  parameterRestrictionSchema,
  validityRuleSchema,
} from "@/lib/qualification-rules";

const isoDate = z
  .string()
  .refine(
    (value) => isMatch(value, "yyyy-MM-dd") && isValid(parseISO(value)),
    "请输入有效日期，格式为 YYYY-MM-DD",
  );

export const upgradeStageRescheduleSchema = z
  .object({
    plannedStart: isoDate,
    plannedEnd: isoDate,
    notes: z.string().trim().optional(),
  })
  .refine((value) => value.plannedEnd >= value.plannedStart, {
    message: "节点结束日期不得早于开始日期",
    path: ["plannedEnd"],
  });

export const upgradeStageCompletionSchema = z.object({
  completedOn: isoDate,
  resultSummary: z.string().trim().min(1, "请填写完成结果摘要"),
});

const adminQualificationRecordFieldsSchema = z.object({
  credentialNumber: z.string().trim().min(1, "请输入证件编号"),
  issueDate: isoDate,
  trainingDate: z.union([isoDate, z.literal("")]).default(""),
  expiryDate: z.union([isoDate, z.literal("")]),
  issuingAuthority: z.string().trim().min(1, "请输入签发机构"),
  levelOrParameter: z.string().trim().min(1, "请输入等级/参数"),
});

const validateQualificationRecordDates = (
  value: {
    issueDate: string;
    trainingDate: string;
    expiryDate: string;
  },
  context: z.RefinementCtx,
) => {
  if (value.expiryDate && value.expiryDate < value.issueDate) {
    context.addIssue({
      code: "custom",
      message: "到期日期不得早于签发日期",
      path: ["expiryDate"],
    });
  }
};

export const adminQualificationRecordCreateSchema =
  adminQualificationRecordFieldsSchema.superRefine(validateQualificationRecordDates);

export const adminQualificationRecordUpdateSchema = adminQualificationRecordFieldsSchema
  .extend({ expectedVersion: z.number().int().positive() })
  .superRefine(validateQualificationRecordDates);

const stageSchema = z.object({
  id: z.string(),
  name: z.enum(UPGRADE_STAGE_NAMES),
  status: z.enum(["completed", "in_progress", "delayed", "scheduled", "not_started"]),
  plannedStart: isoDate,
  plannedEnd: isoDate,
  owner: z.string().trim().min(1, "请填写责任人"),
  notes: z.string().trim(),
  completedOn: isoDate.optional(),
  resultSummary: z.string().trim().optional(),
  delayDays: z.number().int().min(0).optional(),
});

export const upgradePlanDraftSchema = z
  .object({
    pilotId: z.string().trim().min(1, "请选择飞行员"),
    title: z.string().trim().min(2, "计划名称至少需要 2 个字符"),
    type: z.enum([
      "captain_upgrade",
      "level_upgrade",
      "qualification_recovery",
      "instructor_upgrade",
      "type_rating",
    ]),
    startDate: isoDate,
    endDate: isoDate,
    overallOwner: z.string().trim().min(1, "请选择总责任人"),
    leadDepartment: z.string().trim().min(1, "请填写主导部门"),
    stages: z.array(stageSchema).length(6, "升级计划必须包含六个固定核心节点"),
    inspectionItemSelections: z
      .array(
        z.object({
          inspectionItemId: z.string().uuid("检查项目无效"),
          stageOrder: z.number().int().min(0).max(5),
        }),
      )
      .min(1, "请至少选择一个检查项目")
      .refine(
        (items) => new Set(items.map((item) => item.inspectionItemId)).size === items.length,
        "检查项目不能重复选择",
      ),
    supplementalRequirements: z.array(z.string().trim()),
  })
  .superRefine((value, context) => {
    if (value.endDate < value.startDate) {
      context.addIssue({
        code: "custom",
        message: "整体结束日期不得早于开始日期",
        path: ["endDate"],
      });
    }
    value.stages.forEach((stage, index) => {
      if (stage.name !== UPGRADE_STAGE_NAMES[index]) {
        context.addIssue({
          code: "custom",
          message: "六个核心节点名称与顺序不可更改",
          path: ["stages", index, "name"],
        });
      }
      if (stage.plannedEnd < stage.plannedStart) {
        context.addIssue({
          code: "custom",
          message: "节点结束日期不得早于开始日期",
          path: ["stages", index, "plannedEnd"],
        });
      }
      if (stage.plannedStart < value.startDate || stage.plannedEnd > value.endDate) {
        context.addIssue({
          code: "custom",
          message: "节点日期必须位于整体计划周期内",
          path: ["stages", index, "plannedStart"],
        });
      }
      if (index > 0 && stage.plannedStart < value.stages[index - 1]!.plannedEnd) {
        context.addIssue({
          code: "custom",
          message: "节点日期不得与前一固定顺序节点交叉倒序",
          path: ["stages", index, "plannedStart"],
        });
      }
    });
  });

export const qualificationConfigInputBaseSchema = z.object({
  name: z.string().trim().min(2, "资质名称至少需要 2 个字符"),
  active: z.boolean(),
  parameterRestriction: parameterRestrictionSchema,
  validityRule: validityRuleSchema,
  reminders: z.object({
    firstDays: z.number().int().min(1).max(365),
    secondDays: z.number().int().min(1).max(365),
  }),
  ocrChecks: ocrChecksSchema,
});

type QualificationConfigFields = Omit<z.infer<typeof qualificationConfigInputBaseSchema>, "name">;

function validateQualificationConfig(value: QualificationConfigFields, context: z.RefinementCtx) {
  if (value.reminders.firstDays <= value.reminders.secondDays) {
    context.addIssue({
      code: "custom",
      message: "首次提醒天数必须大于再次提醒天数",
      path: ["reminders", "firstDays"],
    });
  }
  if (value.parameterRestriction.enabled && !value.parameterRestriction.description) {
    context.addIssue({
      code: "custom",
      message: "启用等级/参数限制后请填写说明",
      path: ["parameterRestriction", "description"],
    });
  }
}

export const qualificationConfigInputSchema = qualificationConfigInputBaseSchema.superRefine(
  validateQualificationConfig,
);

export const qualificationConfigPatchSchema = qualificationConfigInputBaseSchema
  .omit({ name: true })
  .extend({ expectedVersion: z.number().int().positive().optional() })
  .superRefine(validateQualificationConfig);

export const qualificationConfigCreateSchema = qualificationConfigInputBaseSchema
  .extend({
    code: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
  })
  .superRefine(validateQualificationConfig);

export function firstValidationMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "提交内容无效";
}
