import { normalizeAppLocale, type AppLocale, upgradeStageLabel } from "@/lib/domain-i18n";

export const NOTIFICATION_TEMPLATE_KEYS = [
  "legacy.raw",
  "qualification.expiry.expired",
  "qualification.expiry.due",
  "qualification.review.approved",
  "qualification.review.returned",
  "qualification.rollback",
  "upgrade.plan.created",
  "upgrade.plan.started",
  "upgrade.plan.resumed",
  "upgrade.stage.upcoming",
  "upgrade.stage.rescheduled",
  "upgrade.stage.completed",
  "delivery.failed",
  "pilot.access_link",
] as const;

export type NotificationTemplateKey = (typeof NOTIFICATION_TEMPLATE_KEYS)[number];
export type NotificationTemplateParams = Record<string, unknown>;

function params(value: unknown): NotificationTemplateParams {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as NotificationTemplateParams)
    : {};
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isTemplateKey(value: unknown): value is NotificationTemplateKey {
  return NOTIFICATION_TEMPLATE_KEYS.some((key) => key === value);
}

export function notificationTemplateData(
  templateKey: NotificationTemplateKey,
  templateParams: NotificationTemplateParams = {},
  locale: AppLocale = "zh-CN",
) {
  return { templateKey, templateParams, locale };
}

export function renderNotificationContent(input: {
  templateKey: unknown;
  templateParams: unknown;
  locale?: unknown;
}): { summary: string; message: string } {
  const locale = normalizeAppLocale(input.locale);
  const key = isTemplateKey(input.templateKey) ? input.templateKey : "legacy.raw";
  const value = params(input.templateParams);
  const zh = locale === "zh-CN";
  const qualificationName = text(value.qualificationName, zh ? "资质" : "Qualification");
  const pilotName = text(value.pilotName, zh ? "飞行员" : "Pilot");
  const planTitle = text(value.planTitle, zh ? "升级计划" : "Upgrade plan");
  const stageName = upgradeStageLabel(value.stageCode, locale, number(value.stageOrder));

  switch (key) {
    case "qualification.expiry.expired":
      return {
        summary: zh ? `${qualificationName}已过期` : `${qualificationName} has expired`,
        message: zh
          ? `${pilotName} 的${qualificationName}已过期，请尽快处理。`
          : `${pilotName}'s ${qualificationName} has expired. Please take action promptly.`,
      };
    case "qualification.expiry.due": {
      const days = number(value.daysRemaining);
      return {
        summary: zh ? `${qualificationName}即将到期` : `${qualificationName} expires soon`,
        message: zh
          ? `${pilotName} 的${qualificationName}将在 ${days} 天后到期。`
          : `${pilotName}'s ${qualificationName} expires in ${days} day${days === 1 ? "" : "s"}.`,
      };
    }
    case "qualification.review.approved":
      return {
        summary: zh ? "资质审核通过" : "Qualification review approved",
        message: zh
          ? `${qualificationName}审核已通过`
          : `${qualificationName} review has been approved.`,
      };
    case "qualification.review.returned":
      return {
        summary: zh ? "资质申请需补充" : "Qualification submission needs updates",
        message: text(value.reason),
      };
    case "qualification.rollback":
      return {
        summary: zh ? "资质已回滚到历史版本" : "Qualification restored to a prior revision",
        message: zh
          ? "资质历史版本已恢复为当前生效版本，请查看详情。"
          : "A historical qualification revision is active again. Review the details.",
      };
    case "upgrade.plan.created":
      return {
        summary: zh ? `升级计划已创建：${planTitle}` : `Upgrade plan created: ${planTitle}`,
        message: zh
          ? "升级计划已经启动，请按计划查看并完成各检查节点。"
          : "The upgrade plan has started. Review and complete each inspection stage.",
      };
    case "upgrade.plan.started":
      return {
        summary: zh ? `升级计划已启动：${planTitle}` : `Upgrade plan started: ${planTitle}`,
        message: zh
          ? "升级计划状态已变更，请查看最新计划安排。"
          : "The upgrade plan status changed. Review the latest schedule.",
      };
    case "upgrade.plan.resumed":
      return {
        summary: zh ? `升级计划已恢复：${planTitle}` : `Upgrade plan resumed: ${planTitle}`,
        message: zh
          ? "升级计划状态已变更，请查看最新计划安排。"
          : "The upgrade plan status changed. Review the latest schedule.",
      };
    case "upgrade.stage.upcoming": {
      const days = number(value.days);
      return {
        summary: zh
          ? `升级节点将在 ${days === 0 ? "今天" : `${days} 天后`}开始：${stageName}`
          : `${stageName} starts ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}`,
        message: zh
          ? `${pilotName}，升级计划「${planTitle}」的${stageName}节点即将开始，请提前准备。`
          : `${pilotName}, the ${stageName} stage of “${planTitle}” starts soon. Please prepare in advance.`,
      };
    }
    case "upgrade.stage.rescheduled":
      return {
        summary: zh ? `节点日期变更：${stageName}` : `Stage rescheduled: ${stageName}`,
        message: zh
          ? "升级节点信息已更新，请查看最新计划。"
          : "The upgrade stage was updated. Review the latest plan.",
      };
    case "upgrade.stage.completed":
      return {
        summary: zh ? `节点完成：${stageName}` : `Stage completed: ${stageName}`,
        message: zh
          ? "升级节点信息已更新，请查看最新计划。"
          : "The upgrade stage was updated. Review the latest plan.",
      };
    case "delivery.failed": {
      const source = renderNotificationContent({
        templateKey: value.sourceTemplateKey,
        templateParams: value.sourceTemplateParams,
        locale,
      });
      const channel = text(value.channel, "UNKNOWN");
      const category = text(value.errorCategory, "unknown");
      const reason = text(value.finalFailureReason, zh ? "未知错误" : "Unknown error");
      return {
        summary: zh ? `通知投递失败：${source.summary}` : `Delivery failed: ${source.summary}`,
        message: zh
          ? `${channel} 投递已达到重试上限（${category}）：${reason}`
          : `${channel} reached its retry limit (${category}): ${reason}`,
      };
    }
    case "pilot.access_link": {
      const accessUrl = text(value.accessUrl);
      const ttlMinutes = number(value.ttlMinutes);
      return {
        summary: zh ? "Pilot 访问链接" : "Pilot access link",
        message: accessUrl
          ? zh
            ? `CrewQual 访问链接：${accessUrl}（${ttlMinutes}分钟内有效）`
            : `CrewQual access link: ${accessUrl} (valid for ${ttlMinutes} minutes)`
          : zh
            ? "CrewQual 一次性访问链接"
            : "CrewQual one-time access link",
      };
    }
    case "legacy.raw":
    default:
      return { summary: text(value.summary), message: text(value.message) };
  }
}
