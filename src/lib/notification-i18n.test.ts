import { describe, expect, it } from "vitest";
import { renderNotificationContent } from "@/lib/notification-i18n";

describe("notification i18n templates", () => {
  it("renders the same stable template key in Chinese and English", () => {
    const input = {
      templateKey: "upgrade.stage.upcoming",
      templateParams: {
        pilotName: "Alex",
        planTitle: "Captain upgrade",
        stageCode: "SIMULATOR_CHECK",
        stageOrder: 3,
        days: 1,
      },
    };

    expect(renderNotificationContent({ ...input, locale: "zh-CN" })).toMatchObject({
      summary: "升级节点将在 1 天后开始：模拟机检查",
    });
    expect(renderNotificationContent({ ...input, locale: "en-US" })).toMatchObject({
      summary: "Simulator check starts in 1 day",
    });
  });

  it("keeps migrated legacy content readable", () => {
    expect(
      renderNotificationContent({
        templateKey: "legacy.raw",
        templateParams: { summary: "旧标题", message: "旧正文" },
        locale: "zh-CN",
      }),
    ).toEqual({ summary: "旧标题", message: "旧正文" });
  });
});
