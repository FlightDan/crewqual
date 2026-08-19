/**
 * Compatibility labels retained for existing callers/tests. Runtime navigation
 * renders `navigation.*` message keys, so these are not user-facing English UI literals.
 */
export const legacyAdminNavLabels = {
  overview: "总览",
  calendar: "日历",
  members: "成员管理",
  reviews: "待审核",
  notifications: "通知记录",
  settings: "系统设置",
} as const;

export const legacyAdminRouteTitles: Record<string, string> = {
  dashboard: "系统总览 Dashboard",
  calendar: "统一日历",
  members: "成员管理与职位概览",
  member: "成员详情档案",
  positionMembers: "职位成员列表",
  positionQualifications: "职位资质管理",
  pilots: "飞行员管理与资质大盘",
  pilot: "飞行员详情档案",
  reviews: "待审核资质更新",
  review: "资质审核工作台",
  notifications: "通知与预警记录日志",
  settings: "系统设置",
  qualificationConfig: "核心资质项目配置",
  upgradePlans: "升级计划管理",
  upgradePlan: "升级计划详情",
  newUpgradePlan: "新建机组升级计划",
  forbidden: "访问受限",
};
