import { expect, test, type Page } from "@playwright/test";

function captureRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function gotoAfterClientNavigation(page: Page, url: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url);
      return;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        (!error.message.includes("interrupted by another navigation") &&
          !error.message.includes("NS_BINDING_ABORTED")) ||
        attempt === 2
      ) {
        throw error;
      }
      await page.waitForTimeout(250);
    }
  }
}

test.describe("admin operations workflow", () => {
  test("calendar reschedule synchronizes plan detail and notification log", async ({ page }) => {
    await page.goto(
      "/admin/calendar?date=2026-08-14&event=upgrade%3Aupgrade-01%3Aupgrade-01-stage-5",
    );
    await expect(page.getByTestId("calendar-event-detail")).toContainText("航线检查");
    await page.getByRole("button", { name: "调整节点日期" }).click();
    await page.getByLabel("计划开始日期").fill("2026-08-13");
    await page.getByLabel("计划结束日期").fill("2026-08-19");
    await page.getByRole("button", { name: "保存调整" }).click();
    await gotoAfterClientNavigation(page, "/admin/upgrade-plans/upgrade-01");
    await expect(page.getByText("2026-08-13 至 2026-08-19")).toBeVisible();
    await gotoAfterClientNavigation(
      page,
      "/admin/notifications?q=%E8%8A%82%E7%82%B9%E6%97%A5%E6%9C%9F%E5%8F%98%E6%9B%B4",
    );
    await expect(
      page.getByRole("cell", { name: /航线检查 → 2026-08-13 至 2026-08-19/ }),
    ).toBeVisible();
  });

  test("qualification calendar event opens the shared qualification editor", async ({ page }) => {
    await page.goto(
      "/admin/calendar?date=2026-08-05&event=qualification%3Apilot-demo-02%3Amedical-certificate",
    );
    await expect(page.getByTestId("calendar-event-detail")).toContainText("当前生效资质记录");
    await expect(page.getByRole("button", { name: "调整节点日期" })).toHaveCount(0);
    await page.getByRole("button", { name: "编辑此资质" }).click();
    await page.getByLabel("到期日期").fill("2026-08-06");
    await page.getByRole("button", { name: "保存资质" }).click();
    await expect(page.getByRole("status")).toContainText("资质记录已更新");
    await expect(page.getByTestId("calendar-event-detail")).toContainText("2026-08-06");
  });

  test("selected day lists each node pilot's six qualifications and edits in place", async ({
    page,
  }) => {
    await page.goto(
      "/admin/calendar?event=upgrade%3Aupgrade-04%3Aupgrade-04-stage-3&date=2026-08-15",
    );
    await expect(page.getByTestId("calendar-event-detail")).toContainText("大队评估");
    await page.getByRole("button", { name: "关闭" }).click();
    const pilot = page.getByTestId("calendar-day-pilot-pilot-demo-04");
    await expect(pilot).toContainText("吴岚（示例）");
    await expect(pilot.getByRole("button", { name: /^编辑吴岚/ })).toHaveCount(2);
    await expect(pilot).toContainText("其余 4 项正常");
    await expect(pilot).not.toContainText("机组年度复训合格证");
    await pilot.getByRole("button", { name: "编辑吴岚（示例）的危险品运输培训合格证" }).click();
    await page.getByLabel("到期日期").fill("2026-08-20");
    await page.getByRole("button", { name: "保存资质" }).click();
    await expect(page.getByRole("status")).toContainText("资质记录已更新");
    await expect(pilot).toContainText("2026-08-20");
  });

  test("mobile three-step creation appears in detail, calendar and notifications", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/upgrade-plans/new", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "下一步，配置节点计划" }).click();
    await expect(page).toHaveURL(/step=stages/);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "下一步，确认创建" }).click();
    await expect(page).toHaveURL(/step=confirm/);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "确认创建计划" }).click();
    await page.getByRole("button", { name: "确认创建并启动" }).click();
    await page.waitForURL(/\/admin\/upgrade-plans\/PLAN-/, { waitUntil: "networkidle" });
    await expect(page.getByRole("main").getByText("赵宁（示例）").first()).toBeVisible();
    await expect(page.getByText("进行中").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await gotoAfterClientNavigation(page, "/admin/upgrade-plans?q=MOCK-1301");
    await expect(
      page.locator("a:visible").filter({ hasText: "赵宁（示例）" }).first(),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await gotoAfterClientNavigation(
      page,
      "/admin/calendar?view=agenda&date=2026-09-01&q=MOCK-1301",
    );
    await expect(page.getByText("理论口试").first()).toBeVisible();
    await gotoAfterClientNavigation(page, "/admin/notifications?q=%E8%B5%B5%E5%AE%81");
    await expect(
      page.locator("button:visible").filter({ hasText: "升级计划已创建" }).first(),
    ).toBeVisible();
  });

  test("draft survives refresh and an active-plan conflict cannot start", async ({ page }) => {
    await page.goto("/admin/upgrade-plans/new?step=confirm");
    await page.getByRole("button", { name: "仅保存为草稿" }).click();
    await expect(page).toHaveURL(/\/admin\/upgrade-plans\/PLAN-/);
    await expect(page.getByText("草稿").first()).toBeVisible();
    await page.reload();
    await expect(page.getByText("草稿").first()).toBeVisible();

    await page.goto("/admin/upgrade-plans/new");
    await page.getByLabel("选择飞行员 *").selectOption("pilot-demo-01");
    await expect(page.getByText(/已有活动计划 UP20260001/)).toBeVisible();
    await expect(page.getByRole("button", { name: "创建升级计划并启动通知" })).toBeDisabled();
  });

  test("plan can pause, resume, validate cancellation and become read-only", async ({ page }) => {
    await page.goto("/admin/upgrade-plans/upgrade-01");
    await page.getByRole("button", { name: "暂停计划" }).click();
    await page.getByRole("button", { name: "确认操作" }).click();
    await expect(page.getByText("已暂停").first()).toBeVisible();
    await page.getByRole("button", { name: "恢复计划" }).click();
    await page.getByRole("button", { name: "确认操作" }).click();
    await expect(page.getByText("进行中（已延期）").first()).toBeVisible();
    await page.getByRole("button", { name: "取消计划" }).click();
    await page.getByLabel("取消原因 *").fill("短");
    await page.getByRole("button", { name: "确认操作" }).click();
    await expect(page.getByRole("alert").getByText("取消原因至少需要 5 个字符")).toBeVisible();
    await page.getByLabel("取消原因 *").fill("训练路线发生确定性调整");
    await page.getByRole("button", { name: "确认操作" }).click();
    await expect(page.getByText(/进入只读状态/)).toBeVisible();
    await expect(page.getByRole("button", { name: "调整日期" })).toHaveCount(0);
  });

  test("qualification config validates, persists and leaves effective records unchanged", async ({
    page,
  }) => {
    await page.goto("/admin/pilots/pilot-demo-01");
    const before = page
      .getByTestId("pilot-detail-desktop")
      .getByRole("row")
      .filter({ hasText: "民用航空人员体检合格证" });
    await expect(before).toContainText("2027-08-10");
    await gotoAfterClientNavigation(page, "/admin/qualification-config");
    await page.getByLabel("首次提醒（到期前天数） *").fill("20");
    await page.getByLabel("再次提醒（到期前天数） *").fill("30");
    await page.getByRole("button", { name: "保存并查看影响摘要" }).click();
    await expect(page.getByText("首次提醒天数必须大于再次提醒天数")).toBeVisible();
    await page.getByLabel("首次提醒（到期前天数） *").fill("90");
    await page.getByLabel("再次提醒（到期前天数） *").fill("45");
    await page.getByRole("button", { name: "保存并查看影响摘要" }).click();
    await page.getByRole("button", { name: "确认保存" }).click();
    await expect(page.getByText(/现有生效记录未被回写/)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("首次提醒（到期前天数） *")).toHaveValue("90");
    await page.goto("/admin/pilots/pilot-demo-01");
    await expect(
      page
        .getByTestId("pilot-detail-desktop")
        .getByRole("row")
        .filter({ hasText: "民用航空人员体检合格证" }),
    ).toContainText("2027-08-10");
  });

  test("qualification config selection is local and produces no navigation request", async ({
    page,
  }) => {
    await page.goto("/admin/qualification-config?config=config-medical-certificate");
    await expect(page.getByTestId("qualification-config-editor")).toBeVisible();
    const requests: string[] = [];
    const captureRequest = (request: { url(): string }) => {
      const url = request.url();
      if (url.includes("_rsc=") || url.includes("/api/admin/")) requests.push(url);
    };
    page.on("request", captureRequest);

    await page.getByTestId("qualification-config-config-simulator-recurrent-training").click();
    await expect(
      page.getByRole("heading", { name: /模拟机复训（每6个月） - 资质项目配置/ }),
    ).toBeVisible();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    page.off("request", captureRequest);

    await expect(page).toHaveURL(/config=config-simulator-recurrent-training/);
    expect(requests).toEqual([]);
  });

  test("failed notification retry appends history and keeps Mock labeling", async ({ page }) => {
    await page.goto("/admin/notifications?status=failed&notification=NOT-1003");
    await expect(page.getByRole("dialog").getByText("发送失败").first()).toBeVisible();
    await expect(page.getByText(/未调用真实短信/)).toBeVisible();
    await page.getByRole("button", { name: "Mock 重新发送" }).click();
    await expect(page.getByRole("dialog").getByText("已发送（演示）").first()).toBeVisible();
    await expect(page.getByText("尝试历史（3）")).toBeVisible();
    await expect(page.getByText(/确定性 Mock 重发成功/)).toBeVisible();
  });

  test("manual review return creates neutral notification wording", async ({ page }) => {
    await page.goto("/admin/reviews/REV-1003");
    await page.getByRole("button", { name: "退回修改" }).click();
    await page.getByLabel("退回原因 *").fill("请重新上传完整且清晰的示例凭证");
    await page.getByRole("button", { name: "确认退回" }).click();
    await page.goto(
      "/admin/notifications?q=%E4%BA%BA%E5%B7%A5%E5%AE%A1%E6%A0%B8%E9%80%80%E5%9B%9E",
    );
    await expect(page.getByText(/人工审核退回/).first()).toBeVisible();
    await expect(page.getByText(/AI.*自动退回/)).toHaveCount(0);
  });

  for (const route of [
    "/admin/calendar?date=2026-08-14",
    "/admin/upgrade-plans",
    "/admin/upgrade-plans/new?step=stages",
    "/admin/qualification-config",
    "/admin/notifications",
  ]) {
    test(`390x844 operation page has no horizontal overflow: ${route}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
      await expect(page.getByTestId("mobile-bottom-nav")).toBeVisible();
      if (route.startsWith("/admin/calendar")) {
        await page.getByTestId("calendar-filter-trigger").click();
        await expect(page.getByRole("dialog", { name: "日历筛选" })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          390,
        );
        await page.getByRole("button", { name: "完成" }).click();
      }
    });
  }

  test("mobile date click opens the day qualification roster drawer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/calendar?date=2026-08-15");
    await page.getByRole("button", { name: /^2026-08-15，/ }).click();
    await expect(page.getByRole("dialog")).toContainText("2026-08-15 当日人员资质");
    await expect(page.getByRole("dialog")).toContainText("吴岚（示例）");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });

  test("1440x768 shows the full desktop calendar with compact upgrade markers", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 768 });
    await page.goto("/admin/calendar?date=2026-08-14");
    await expect(page.getByTestId("desktop-sidebar")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "统一日历" })).toBeVisible();
    await expect(
      page.getByText("资质事件来自生效记录，升级事件来自计划节点；日历不保存静态副本"),
    ).toHaveCount(0);
    await expect(page.getByTestId("calendar-filter-trigger")).toBeVisible();
    await expect(page.getByLabel("视图")).toHaveCount(0);
    const toolbar = page.getByTestId("calendar-toolbar");
    const datePicker = page.getByLabel("选择日期");
    await expect(datePicker).toHaveValue("2026-08-14");
    await expect(toolbar).not.toContainText("跳转日期");
    await expect(toolbar).not.toContainText("2026年8月");
    await expect(toolbar.getByRole("button", { name: "今天" })).toBeVisible();
    const monthCalendar = page.getByTestId("month-calendar");
    await expect(monthCalendar).toBeVisible();
    await expect(monthCalendar.getByText("1个升级", { exact: true }).first()).toBeVisible();
    await expect(monthCalendar.getByText(/活跃中的升级计划/)).toHaveCount(0);
    const calendarBox = await monthCalendar.boundingBox();
    const toolbarBox = await toolbar.boundingBox();
    const datePickerBox = await datePicker.boundingBox();
    expect(calendarBox?.y).toBeLessThan(300);
    expect((calendarBox?.y ?? 0) + (calendarBox?.height ?? 0)).toBeLessThanOrEqual(768);
    expect(Math.abs((toolbarBox?.y ?? 0) - (calendarBox?.y ?? 0))).toBeLessThanOrEqual(1);
    expect(toolbarBox?.x).toBeGreaterThanOrEqual((calendarBox?.x ?? 0) + (calendarBox?.width ?? 0));
    expect(toolbarBox?.width).toBeLessThanOrEqual(360);
    expect(toolbarBox?.height).toBeLessThanOrEqual(36);
    expect(datePickerBox?.x).toBeGreaterThan((calendarBox?.x ?? 0) + (calendarBox?.width ?? 0) / 2);
    await datePicker.fill("2026-08-20");
    await expect(page).toHaveURL(/date=2026-08-20/);
    await expect(datePicker).toHaveValue("2026-08-20");
    await page.getByTestId("calendar-filter-trigger").click();
    await page.getByLabel("视图").selectOption("week");
    await page.getByRole("button", { name: "完成" }).click();
    await expect(page.getByTestId("week-calendar")).toBeVisible();
    await expect(page.getByTestId("calendar-toolbar")).not.toContainText("至");
    await expect(page.getByTestId("mobile-bottom-nav")).toBeHidden();
  });

  test("invalid calendar URL values fall back deterministically", async ({ page }) => {
    await page.goto("/admin/calendar?view=broken&date=not-a-date&type=broken");
    await expect(page).toHaveURL(/\/admin\/calendar\?date=2026-08-14$/);
    await page.getByTestId("calendar-filter-trigger").click();
    await expect(page.getByLabel("视图")).toHaveValue("month");
    await expect(page.getByTestId("month-calendar")).toBeVisible();
  });

  test("calendar filters use a collapsed drawer, persist in the URL and reset without changing date", async ({
    page,
  }) => {
    await page.goto("/admin/calendar?date=2026-08-14");
    await page.locator('[data-app-ready="true"]').waitFor();
    await expect(page.getByLabel("中队", { exact: true })).toHaveCount(0);
    await page.getByTestId("calendar-filter-trigger").click();
    await expect(page.getByRole("dialog", { name: "日历筛选" })).toBeVisible();
    await page.getByLabel("中队", { exact: true }).click();
    await page.getByRole("checkbox", { name: "一大队一中队" }).click();
    await expect(page).toHaveURL(/units=/);
    await page.getByRole("button", { name: "完成" }).click();
    await expect(page.getByRole("dialog", { name: "日历筛选" })).toHaveCount(0);
    await expect(page.getByTestId("calendar-filter-trigger")).toHaveAccessibleName(
      "筛选，已启用 1 项",
    );
    await page.reload();
    await expect(page.getByLabel("中队", { exact: true })).toHaveCount(0);
    await page.getByTestId("calendar-filter-trigger").click();
    await expect(page.getByLabel("中队", { exact: true })).toContainText("一大队一中队");
    await page.getByRole("button", { name: "重置筛选" }).click();
    await expect(page).toHaveURL(/\/admin\/calendar\?date=2026-08-14$/);
    await expect(page.getByLabel("选择日期")).toHaveValue("2026-08-14");
    await page.getByRole("button", { name: "完成" }).click();
    await expect(page.getByTestId("calendar-filter-trigger")).toHaveAccessibleName("筛选");
  });

  test("development entry covers every lifecycle, validity rule and delivery state @dev", async ({
    page,
  }) => {
    await page.goto("/dev/admin-operations");
    for (const href of [
      "/admin/upgrade-plans/upgrade-01",
      "/admin/upgrade-plans/upgrade-02",
      "/admin/upgrade-plans/upgrade-03",
      "/admin/upgrade-plans/upgrade-04",
      "/admin/upgrade-plans/upgrade-05",
      "/admin/upgrade-plans/upgrade-06",
    ]) {
      await expect(page.locator(`a[href="${href}"]`)).toHaveCount(1);
    }
    await expect(page.locator('a[href*="config=config-annual-recurrent-training"]')).toHaveCount(1);
    await expect(page.locator('a[href*="config=config-medical-certificate"]')).toHaveCount(1);
    await expect(page.locator('a[href*="config=config-chinese-language-assessment"]')).toHaveCount(
      1,
    );
    for (const status of ["sent", "failed", "queued"]) {
      await expect(page.locator(`a[href*="status=${status}"]`)).toHaveCount(1);
    }
  });

  for (const route of [
    "/admin/calendar",
    "/admin/upgrade-plans",
    "/admin/upgrade-plans/upgrade-01",
    "/admin/upgrade-plans/new",
    "/admin/qualification-config",
    "/admin/notifications",
    "/dev/admin-operations",
    "/admin/upgrade-plans/does-not-exist",
  ]) {
    const devTag = route.startsWith("/dev/") ? " @dev" : "";
    test(`fourth-batch page has no uncaught or hydration errors: ${route}${devTag}`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      const errors = captureRuntimeErrors(page);
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      expect(errors).toEqual([]);
    });
  }
});
