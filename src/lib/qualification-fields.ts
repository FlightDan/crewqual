import { z } from "zod";

export const qualificationFieldValueTypeSchema = z.enum([
  "text",
  "digits",
  "english",
  "alphanumeric",
]);

export const qualificationCustomFieldSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{2,63}$/, "条目标识无效"),
    label: z.string().trim().min(1, "请填写条目名称").max(50, "条目名称最多 50 个字符"),
    valueType: qualificationFieldValueTypeSchema,
    required: z.boolean(),
    minLength: z.number().int().min(0).max(256),
    maxLength: z.number().int().min(0).max(256),
    placeholder: z.string().trim().max(100, "填写提示最多 100 个字符"),
  })
  .superRefine((field, context) => {
    if (field.minLength > 0 && field.maxLength > 0 && field.minLength > field.maxLength) {
      context.addIssue({
        code: "custom",
        path: ["maxLength"],
        message: "最多位数不能小于最少位数",
      });
    }
  });

export const qualificationCustomFieldsSchema = z
  .array(qualificationCustomFieldSchema)
  .max(30, "每个资质最多添加 30 个自定义条目")
  .superRefine((fields, context) => {
    const ids = new Set<string>();
    const labels = new Set<string>();
    fields.forEach((field, index) => {
      if (ids.has(field.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "条目标识不能重复",
        });
      }
      ids.add(field.id);
      const normalizedLabel = field.label.toLocaleLowerCase();
      if (labels.has(normalizedLabel)) {
        context.addIssue({
          code: "custom",
          path: [index, "label"],
          message: "条目名称不能重复",
        });
      }
      labels.add(normalizedLabel);
    });
  });

export type QualificationFieldValueType = z.infer<typeof qualificationFieldValueTypeSchema>;
export type QualificationCustomField = z.infer<typeof qualificationCustomFieldSchema>;

export const qualificationFieldValueTypeLabels: Record<QualificationFieldValueType, string> = {
  text: "任意文本",
  digits: "仅数字",
  english: "仅英文字母",
  alphanumeric: "英文和数字",
};

export function customFieldsFromFieldSchema(value: unknown): QualificationCustomField[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const parsed = qualificationCustomFieldsSchema.safeParse(
    (value as Record<string, unknown>).customFields,
  );
  return parsed.success ? parsed.data : [];
}

export function fieldSchemaWithCustomFields(
  current: unknown,
  customFields: QualificationCustomField[],
): Record<string, unknown> {
  const base = current && typeof current === "object" && !Array.isArray(current) ? current : {};
  return { ...base, customFields };
}

export function validateQualificationCustomFieldValues(
  fields: QualificationCustomField[],
  values: Record<string, string | undefined>,
) {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.id]?.trim() ?? "";
    if (field.required && !value) {
      errors[field.id] = `请填写${field.label}`;
      continue;
    }
    if (!value) continue;
    if (field.valueType === "digits" && !/^\d+$/u.test(value)) {
      errors[field.id] = `${field.label}只能填写数字`;
      continue;
    }
    if (field.valueType === "english" && !/^[A-Za-z]+$/u.test(value)) {
      errors[field.id] = `${field.label}只能填写英文字母`;
      continue;
    }
    if (field.valueType === "alphanumeric" && !/^[A-Za-z0-9]+$/u.test(value)) {
      errors[field.id] = `${field.label}只能填写英文和数字`;
      continue;
    }
    if (field.minLength > 0 && value.length < field.minLength) {
      errors[field.id] = `${field.label}至少需要 ${field.minLength} 位`;
      continue;
    }
    if (field.maxLength > 0 && value.length > field.maxLength) {
      errors[field.id] = `${field.label}最多允许 ${field.maxLength} 位`;
    }
  }
  return errors;
}
