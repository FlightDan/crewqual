import { describe, expect, it } from "vitest";
import {
  CORE_QUALIFICATION_CATALOG,
  CORE_QUALIFICATION_IDS,
  UPGRADE_STAGE_NAMES,
} from "@/types/services";

describe("shared service terminology", () => {
  it("keeps the six core qualifications in one stable id/name/code order", () => {
    expect(CORE_QUALIFICATION_CATALOG).toHaveLength(6);
    expect(CORE_QUALIFICATION_IDS).toEqual(
      CORE_QUALIFICATION_CATALOG.map((qualification) => qualification.id),
    );
    expect(new Set(CORE_QUALIFICATION_IDS).size).toBe(CORE_QUALIFICATION_IDS.length);
    expect(CORE_QUALIFICATION_CATALOG.map((qualification) => qualification.name)).toEqual([
      "民用航空人员体检合格证",
      "机组年度复训合格证",
      "危险品运输培训合格证",
      "ICAO英语语言能力等级签注",
      "汉语语言能力评估",
      "模拟机复训（每6个月）",
    ]);
  });

  it("keeps upgrade stage terminology fixed and ordered", () => {
    expect(UPGRADE_STAGE_NAMES).toEqual([
      "理论口试",
      "中队评估",
      "大队评估",
      "模拟机检查",
      "航线检查",
      "实践考试",
    ]);
  });
});
