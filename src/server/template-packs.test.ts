import { describe, expect, it } from "vitest";
import {
  PILOT_TEMPLATE_PACK,
  parseTemplatePack,
  templatePackChecksum,
} from "@/server/template-packs";

describe("qualification template packs", () => {
  it("keeps the built-in pilot pack data-driven and manually reviewed", () => {
    const pack = parseTemplatePack(PILOT_TEMPLATE_PACK);

    expect(pack.positions).toEqual([expect.objectContaining({ code: "PILOT", name: "飞行员" })]);
    expect(pack.qualificationDefinitions).toHaveLength(6);
    expect(pack.qualificationDefinitions.every((item) => item.requiresHumanReview)).toBe(true);
    expect(pack.qualificationDefinitions.every((item) => !item.allowAutoApproval)).toBe(true);
    expect(pack.requirements.every((item) => item.upgradePrerequisite)).toBe(true);
    expect(
      pack.qualificationDefinitions.every((item) => item.validityRule.kind === "manual_expiry"),
    ).toBe(true);
  });

  it("produces a stable checksum regardless of object key order", () => {
    const pack = parseTemplatePack(PILOT_TEMPLATE_PACK);
    const reordered = {
      requirements: pack.requirements,
      qualificationDefinitions: pack.qualificationDefinitions,
      positions: pack.positions,
      organizationDefaults: pack.organizationDefaults,
      translations: pack.translations,
      descriptionTranslations: pack.descriptionTranslations,
      description: pack.description,
      name: pack.name,
      industryCode: pack.industryCode,
      version: pack.version,
      code: pack.code,
      schemaVersion: pack.schemaVersion,
    };

    expect(templatePackChecksum(pack)).toMatch(/^[a-f0-9]{64}$/);
    expect(templatePackChecksum(pack)).toBe(templatePackChecksum(reordered));
  });

  it("rejects duplicate codes and dangling requirement references", () => {
    const duplicatePosition = {
      ...PILOT_TEMPLATE_PACK,
      positions: [...PILOT_TEMPLATE_PACK.positions, PILOT_TEMPLATE_PACK.positions[0]!],
    };
    expect(() => parseTemplatePack(duplicatePosition)).toThrow("重复职位 code");

    const danglingRequirement = {
      ...PILOT_TEMPLATE_PACK,
      requirements: [
        ...PILOT_TEMPLATE_PACK.requirements,
        { positionCode: "CABIN_CREW", qualificationCode: "unknown", required: true },
      ],
    };
    expect(() => parseTemplatePack(danglingRequirement)).toThrow("不存在的职位或资质");
  });
});
