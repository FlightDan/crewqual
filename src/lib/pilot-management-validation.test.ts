import { describe, expect, it } from "vitest";
import {
  createPilotCsvTemplate,
  parseCsvMatrix,
  parsePilotCsv,
  pilotCsvHeaders,
} from "@/lib/pilot-management-validation";

const qualifications = [
  {
    id: "medical",
    code: "medical-certificate",
    name: "体检合格证",
    validityRule: { kind: "manual_expiry" as const },
    ruleVersion: 1,
    parameterRestriction: { enabled: false, description: "" },
  },
  {
    id: "english",
    code: "icao-english",
    name: "ICAO 英语",
    validityRule: { kind: "manual_expiry" as const },
    ruleVersion: 1,
    parameterRestriction: { enabled: false, description: "" },
  },
];

describe("pilot CSV validation", () => {
  it("builds a BOM template with base columns and four dynamic columns per qualification", () => {
    const template = createPilotCsvTemplate(qualifications);
    expect(
      template.startsWith(
        "\uFEFFemployeeNumber,displayName,mobile,aircraftType,roleCode,unitCode,rankCode",
      ),
    ).toBe(true);
    expect(parseCsvMatrix(template)[0]).toEqual(pilotCsvHeaders(qualifications));
    expect(parseCsvMatrix(template)[0]).toContain("icao-english.expiryDate");
  });

  it("parses quoted commas and complete qualification triplets", () => {
    const headers = pilotCsvHeaders(qualifications);
    const row = [
      "CQ-2001",
      "张三,示例",
      "13800138001",
      "A320",
      "FIRST_OFFICER",
      "DEMO",
      "FO-2",
      "2026-01-01",
      "",
      "2027-01-01",
      "IA级",
      "",
      "",
      "",
      "",
    ];
    const csv = `${headers.join(",")}\n${row
      .map((value) => (value.includes(",") ? `"${value}"` : value))
      .join(",")}`;
    const parsed = parsePilotCsv(csv, qualifications);
    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      input: {
        employeeNumber: "CQ-2001",
        displayName: "张三,示例",
        roleCode: "FIRST_OFFICER",
      },
      qualifications: [{ qualificationCode: "medical-certificate", levelOrParameter: "IA级" }],
      errors: [],
    });
  });

  it("rejects missing columns, duplicate employees, partial triplets and reversed dates", () => {
    const missing = parsePilotCsv("employeeNumber,displayName\nCQ-1,张三", qualifications);
    expect(missing.fileErrors[0]).toContain("CSV 缺少必需列");

    const headers = pilotCsvHeaders(qualifications);
    const base = ["CQ-2002", "李四", "13800138002", "A320", "CAPTAIN", "DEMO", "CAPT-A"];
    const first = [...base, "2027-01-01", "", "2026-01-01", "IA级", "", "", "", ""];
    const second = [...base, "2026-01-01", "", "", "IA级", "", "", "", ""];
    const parsed = parsePilotCsv(
      `${headers.join(",")}\n${first.join(",")}\n${second.join(",")}`,
      qualifications,
    );
    expect(parsed.rows.every((row) => row.errors.includes("CSV 内员工号重复"))).toBe(true);
    expect(parsed.rows[0]?.errors.join("；")).toContain("到期日期不得早于签发日期");
    expect(parsed.rows[1]?.errors.join("；")).toContain("请填写到期日期");
  });
});
