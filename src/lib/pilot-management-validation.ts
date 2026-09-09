import { isMatch, isValid, parseISO } from "date-fns";
import { z } from "zod";
import type {
  PilotImportQualification,
  PilotImportRow,
  PilotManagementInput,
  PilotManagementMeta,
} from "@/types/services";
import { validateQualificationRuleFields } from "@/lib/qualification-rules";
import { PILOT_ROLE_CODES } from "@/lib/domain-i18n";

export const PILOT_CSV_BASE_HEADERS = [
  "employeeNumber",
  "displayName",
  "mobile",
  "aircraftType",
  "roleCode",
  "unitCode",
  "rankCode",
] as const;

export const pilotManagementInputSchema = z.object({
  employeeNumber: z
    .string()
    .trim()
    .min(1, "请填写员工号")
    .max(64, "员工号最多 64 个字符")
    .regex(/^[A-Za-z0-9_-]+$/, "员工号只能包含字母、数字、短横线和下划线"),
  displayName: z.string().trim().min(1, "请填写姓名").max(64, "姓名最多 64 个字符"),
  mobile: z
    .string()
    .trim()
    .regex(/^\d{11}$/, "手机号必须是 11 位数字"),
  aircraftType: z.string().trim().min(1, "请填写机型").max(32, "机型最多 32 个字符"),
  roleCode: z.enum(PILOT_ROLE_CODES, { message: "roleCode 必须是 CAPTAIN 或 FIRST_OFFICER" }),
  unitCode: z.string().trim().min(1, "请填写单位代码").max(64, "单位代码最多 64 个字符"),
  rankCode: z.string().trim().min(1, "请填写人员级别代码").max(64, "人员级别代码最多 64 个字符"),
});

export const pilotUpdateInputSchema = pilotManagementInputSchema.extend({
  active: z.boolean(),
  expectedVersion: z.number().int().nonnegative(),
});

export const pilotCsvRequestSchema = z.object({
  csvText: z
    .string()
    .min(1, "请选择 CSV 文件")
    .max(2 * 1024 * 1024, "CSV 文件不能超过 2 MB"),
  mode: z.enum(["create_only", "merge"]).default("create_only"),
  confirmMerge: z.boolean().default(false),
});

export const pilotCsvModeSchema = z.enum(["create_only", "merge"]);

export function qualificationCsvHeaders(code: string) {
  return [
    `${code}.issueDate`,
    `${code}.trainingDate`,
    `${code}.expiryDate`,
    `${code}.levelOrParameter`,
  ] as const;
}

export function pilotCsvHeaders(
  qualifications: Array<Pick<PilotManagementMeta["qualifications"][number], "code">>,
) {
  return [
    ...PILOT_CSV_BASE_HEADERS,
    ...qualifications.flatMap((qualification) => qualificationCsvHeaders(qualification.code)),
  ];
}

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function createPilotCsvTemplate(
  qualifications: Array<Pick<PilotManagementMeta["qualifications"][number], "code">>,
) {
  return `\uFEFF${pilotCsvHeaders(qualifications).map(csvCell).join(",")}\r\n`;
}

export function parseCsvMatrix(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("CSV 存在未闭合的双引号");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value.trim() !== ""));
}

function validIsoDate(value: string) {
  return isMatch(value, "yyyy-MM-dd") && isValid(parseISO(value));
}

export type ParsedPilotImportRow = PilotImportRow & { errors: string[] };

export function parsePilotCsv(
  csvText: string,
  qualifications: PilotManagementMeta["qualifications"],
): { rows: ParsedPilotImportRow[]; fileErrors: string[] } {
  let matrix: string[][];
  try {
    matrix = parseCsvMatrix(csvText);
  } catch (error) {
    return {
      rows: [],
      fileErrors: [error instanceof Error ? error.message : "CSV 文件无法解析"],
    };
  }
  if (!matrix.length) return { rows: [], fileErrors: ["CSV 文件为空"] };
  const headers = matrix[0]!.map((header) => header.trim());
  const requiredHeaders = pilotCsvHeaders(qualifications);
  const fileErrors: string[] = [];
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicateHeaders.length) {
    fileErrors.push(`CSV 存在重复列：${[...new Set(duplicateHeaders)].join("、")}`);
  }
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length) fileErrors.push(`CSV 缺少必需列：${missingHeaders.join("、")}`);
  if (matrix.length - 1 > 1000) fileErrors.push("一次最多导入 1000 人");
  if (fileErrors.length) return { rows: [], fileErrors };

  const column = new Map(headers.map((header, index) => [header, index]));
  const valueAt = (values: string[], header: string) =>
    (values[column.get(header) ?? -1] ?? "").trim();
  const rows: ParsedPilotImportRow[] = matrix.slice(1, 1001).map((values, index) => {
    const input: PilotManagementInput = {
      employeeNumber: valueAt(values, "employeeNumber"),
      displayName: valueAt(values, "displayName"),
      mobile: valueAt(values, "mobile"),
      aircraftType: valueAt(values, "aircraftType"),
      roleCode: valueAt(values, "roleCode") as PilotManagementInput["roleCode"],
      unitCode: valueAt(values, "unitCode"),
      rankCode: valueAt(values, "rankCode"),
    };
    const validation = pilotManagementInputSchema.safeParse(input);
    const errors = validation.success ? [] : validation.error.issues.map((issue) => issue.message);
    const importedQualifications: PilotImportQualification[] = [];
    qualifications.forEach((qualification) => {
      const [issueHeader, trainingHeader, expiryHeader, levelHeader] = qualificationCsvHeaders(
        qualification.code,
      );
      const issueDate = valueAt(values, issueHeader);
      const trainingDate = valueAt(values, trainingHeader);
      const expiryDate = valueAt(values, expiryHeader);
      const levelOrParameter = valueAt(values, levelHeader);
      if (!issueDate && !trainingDate && !expiryDate && !levelOrParameter) return;
      if (!issueDate || !levelOrParameter) {
        errors.push(`${qualification.name}的开始日期和级别必须填写`);
        return;
      }
      if (
        !validIsoDate(issueDate) ||
        (trainingDate && !validIsoDate(trainingDate)) ||
        (expiryDate && !validIsoDate(expiryDate))
      ) {
        errors.push(`${qualification.name}日期格式必须为 YYYY-MM-DD`);
        return;
      }
      const ruleValidation = validateQualificationRuleFields(
        {
          issueDate,
          trainingDate: trainingDate || null,
          expiryDate: expiryDate || null,
          levelOrParameter,
        },
        qualification.validityRule,
        qualification.parameterRestriction,
      );
      if (ruleValidation.errors.length) {
        errors.push(`${qualification.name}：${ruleValidation.errors[0]!.message}`);
        return;
      }
      importedQualifications.push({
        qualificationId: qualification.id,
        ...(qualification.definitionId ? { definitionId: qualification.definitionId } : {}),
        ...(qualification.legacyQualificationTypeId
          ? { legacyQualificationTypeId: qualification.legacyQualificationTypeId }
          : {}),
        qualificationCode: qualification.code,
        qualificationName: qualification.name,
        qualificationTranslations: qualification.translations,
        issueDate,
        trainingDate,
        expiryDate: ruleValidation.expiryDate ?? "",
        levelOrParameter,
      });
    });
    return {
      rowNumber: index + 2,
      input: validation.success ? validation.data : input,
      qualifications: importedQualifications,
      errors: [...new Set(errors)],
    };
  });

  const employeeRows = new Map<string, ParsedPilotImportRow[]>();
  rows.forEach((row) => {
    const key = row.input.employeeNumber.toLocaleLowerCase();
    if (!key) return;
    employeeRows.set(key, [...(employeeRows.get(key) ?? []), row]);
  });
  employeeRows.forEach((matches) => {
    if (matches.length > 1) matches.forEach((row) => row.errors.push("CSV 内员工号重复"));
  });
  return { rows, fileErrors };
}
