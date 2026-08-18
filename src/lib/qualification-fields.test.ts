import { describe, expect, it } from "vitest";
import {
  qualificationCustomFieldsSchema,
  validateQualificationCustomFieldValues,
} from "@/lib/qualification-fields";

const fields = [
  {
    id: "field-license-number",
    label: "执照编号",
    valueType: "alphanumeric" as const,
    required: true,
    minLength: 8,
    maxLength: 8,
    placeholder: "请输入 8 位英文和数字",
  },
  {
    id: "field-english-level",
    label: "英文等级",
    valueType: "english" as const,
    required: false,
    minLength: 1,
    maxLength: 3,
    placeholder: "",
  },
];

describe("qualification custom fields", () => {
  it("accepts configurable content and length rules", () => {
    expect(qualificationCustomFieldsSchema.safeParse(fields).success).toBe(true);
    expect(
      validateQualificationCustomFieldValues(fields, {
        "field-license-number": "ABCD1234",
        "field-english-level": "ICA",
      }),
    ).toEqual({});
  });

  it("rejects missing, invalid-character and invalid-length values", () => {
    expect(validateQualificationCustomFieldValues(fields, {})).toEqual({
      "field-license-number": "请填写执照编号",
    });
    expect(
      validateQualificationCustomFieldValues(fields, {
        "field-license-number": "中文1234",
      }),
    ).toEqual({ "field-license-number": "执照编号只能填写英文和数字" });
    expect(
      validateQualificationCustomFieldValues(fields, {
        "field-license-number": "ABC123",
      }),
    ).toEqual({ "field-license-number": "执照编号至少需要 8 位" });
  });

  it("rejects duplicate labels and reversed length ranges", () => {
    const result = qualificationCustomFieldsSchema.safeParse([
      fields[0],
      { ...fields[1], label: "执照编号", minLength: 6, maxLength: 2 },
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining(["条目名称不能重复", "最多位数不能小于最少位数"]),
      );
    }
  });
});
