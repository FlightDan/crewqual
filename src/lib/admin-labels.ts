import type {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationType,
  UpgradePlanLifecycleStatus,
  UpgradePlanType,
} from "@/types/services";

export const upgradeTypeLabels: Record<UpgradePlanType, string> = {
  captain_upgrade: "转机长常规计划",
  level_upgrade: "级别提升",
  qualification_recovery: "资格恢复",
  instructor_upgrade: "教员升级",
  type_rating: "型别升级",
};

export const lifecycleLabels: Record<UpgradePlanLifecycleStatus, string> = {
  draft: "草稿",
  not_started: "未开始",
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
};

export const notificationTypeLabels: Record<NotificationType, string> = {
  qualification_expiry: "资质到期提醒",
  upgrade_stage_reminder: "升级节点提醒",
  stage_date_changed: "节点日期变更",
  stage_completed: "节点完成结果",
  review_returned: "审核退回",
  review_approved: "审核通过",
  upgrade_created: "升级计划创建",
  upgrade_resumed: "升级计划恢复",
  delivery_failed: "通知投递失败",
  pilot_access_link: "Pilot 访问链接",
};

export const channelLabels: Record<NotificationChannel, string> = {
  feishu: "飞书（Mock）",
  sms: "短信（Mock）",
  in_app: "系统内（Mock）",
};

export const deliveryLabels: Record<NotificationDeliveryStatus, string> = {
  queued: "待发送",
  sending: "发送中",
  sent: "已发送（演示）",
  failed: "发送失败",
};
