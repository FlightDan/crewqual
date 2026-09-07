import {
  CORE_QUALIFICATION_CATALOG,
  type PilotProfile,
  type QualificationRecord,
} from "@/types/services";
import { mockFixtureDate } from "@/mocks/test-clock";

export const pilotProfileFixture: PilotProfile = {
  id: "pilot-mock-01",
  employeeNumber: "CQ-1049",
  displayName: "示例飞行员",
  initials: "示",
  role: "机长",
  unit: "一大队一中队",
};

const pilotQualificationExpiry: Record<string, string> = {
  "medical-certificate": mockFixtureDate(-69, "2026-06-06"),
  "annual-recurrent-training": "2027-01-10",
  "dangerous-goods-training": mockFixtureDate(18, "2026-09-01"),
  "icao-english-endorsement": "2026-10-20",
  "chinese-language-assessment": "2027-03-15",
  "simulator-recurrent-training": "2026-12-10",
};

export const pilotQualificationFixtures: QualificationRecord[] = CORE_QUALIFICATION_CATALOG.map(
  (item) => ({
    id: item.id,
    name: item.name,
    translations: item.translations,
    validityRule: { kind: "manual_expiry" },
    timezone: "Asia/Shanghai",
    expiresOn: pilotQualificationExpiry[item.id]!,
    parameter: item.parameter,
    cycleMonths: item.cycleMonths,
    ...(item.id === "simulator-recurrent-training"
      ? {
          parameterRestriction: {
            enabled: true,
            description: "仅允许已批准的模拟机机型",
            version: 1 as const,
            enforcement: {
              mode: "allowed_values" as const,
              allowedValues: ["A320"],
              pattern: "",
            },
          },
        }
      : {}),
  }),
);
