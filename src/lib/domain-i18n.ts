export const APP_LOCALES = ["zh-CN", "en-US"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export function normalizeAppLocale(value: unknown): AppLocale {
  return value === "en-US" ? "en-US" : "zh-CN";
}

export const PILOT_ROLE_CODES = ["CAPTAIN", "FIRST_OFFICER"] as const;
export type PilotRoleCode = (typeof PILOT_ROLE_CODES)[number];

const PILOT_ROLE_LABELS: Record<AppLocale, Record<PilotRoleCode, string>> = {
  "zh-CN": { CAPTAIN: "机长", FIRST_OFFICER: "副驾驶" },
  "en-US": { CAPTAIN: "Captain", FIRST_OFFICER: "First officer" },
};

export function normalizePilotRoleCode(value: unknown): PilotRoleCode {
  if (value === "CAPTAIN" || value === "机长") return "CAPTAIN";
  return "FIRST_OFFICER";
}

export function pilotRoleLabel(value: unknown, locale: AppLocale = "zh-CN") {
  return PILOT_ROLE_LABELS[locale][normalizePilotRoleCode(value)];
}

export const UPGRADE_STAGE_CODES = [
  "THEORY_ORAL",
  "SQUADRON_ASSESSMENT",
  "GROUP_ASSESSMENT",
  "SIMULATOR_CHECK",
  "LINE_CHECK",
  "PRACTICAL_EXAM",
] as const;

export type UpgradeStageCode = (typeof UPGRADE_STAGE_CODES)[number];

const UPGRADE_STAGE_LABELS: Record<AppLocale, Record<UpgradeStageCode, string>> = {
  "zh-CN": {
    THEORY_ORAL: "理论口试",
    SQUADRON_ASSESSMENT: "中队评估",
    GROUP_ASSESSMENT: "大队评估",
    SIMULATOR_CHECK: "模拟机检查",
    LINE_CHECK: "航线检查",
    PRACTICAL_EXAM: "实践考试",
  },
  "en-US": {
    THEORY_ORAL: "Theory oral examination",
    SQUADRON_ASSESSMENT: "Squadron assessment",
    GROUP_ASSESSMENT: "Group assessment",
    SIMULATOR_CHECK: "Simulator check",
    LINE_CHECK: "Line check",
    PRACTICAL_EXAM: "Practical examination",
  },
};

export function normalizeUpgradeStageCode(value: unknown, order = 0): UpgradeStageCode {
  if (typeof value === "string") {
    const byCode = UPGRADE_STAGE_CODES.find((code) => code === value);
    if (byCode) return byCode;
    for (const locale of APP_LOCALES) {
      const byLabel = UPGRADE_STAGE_CODES.find(
        (code) => UPGRADE_STAGE_LABELS[locale][code] === value,
      );
      if (byLabel) return byLabel;
    }
  }
  return UPGRADE_STAGE_CODES[Math.min(Math.max(order, 0), UPGRADE_STAGE_CODES.length - 1)]!;
}

export function upgradeStageLabel(value: unknown, locale: AppLocale = "zh-CN", order = 0) {
  return UPGRADE_STAGE_LABELS[locale][normalizeUpgradeStageCode(value, order)];
}
