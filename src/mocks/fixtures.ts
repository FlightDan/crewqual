import {
  CORE_QUALIFICATION_CATALOG,
  type PilotProfile,
  type QualificationRecord,
} from "@/types/services";

export const pilotProfileFixture: PilotProfile = {
  id: "pilot-mock-01",
  employeeNumber: "CQ-1049",
  displayName: "示例飞行员",
  initials: "示",
  role: "机长",
  unit: "一大队一中队",
};

const pilotQualificationExpiry: Record<string, string> = {
  "medical-certificate": "2026-06-06",
  "annual-recurrent-training": "2027-01-10",
  "dangerous-goods-training": "2026-09-01",
  "icao-english-endorsement": "2026-10-20",
  "chinese-language-assessment": "2027-03-15",
  "simulator-recurrent-training": "2026-12-10",
};

export const pilotQualificationFixtures: QualificationRecord[] = CORE_QUALIFICATION_CATALOG.map(
  (item) => ({
    id: item.id,
    name: item.name,
    translations: item.translations,
    expiresOn: pilotQualificationExpiry[item.id]!,
    parameter: item.parameter,
    cycleMonths: item.cycleMonths,
  }),
);
