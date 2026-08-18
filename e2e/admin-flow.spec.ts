import { expect, test, type Page } from "@playwright/test";
import { qualificationDefinitions } from "../src/mocks/admin-fixtures";
import { pilotCsvHeaders } from "../src/lib/pilot-management-validation";

function captureRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.describe("admin review workflow", () => {
  test("dashboard prioritizes overview and reveals actionable metric details", async ({ page }) => {
    await page.goto("/admin/dashboard");

    const desktopNavigation = page.getByRole("navigation", { name: "管理员主导航" });
    await expect(desktopNavigation.getByRole("link").first()).toHaveText("总览");

    const metrics = [
      ["已过期资质", /查看成员档案/],
      ["7 日内到期", /查看成员档案/],
      ["30 日内到期", /查看成员档案/],
      ["待审核更新", /进入人工审核/],
      ["本周升级节点", /查看升级计划/],
      ["已延期节点", /查看升级计划/],
    ] as const;

    for (const [label, actionName] of metrics) {
      const card = page.getByTestId(`dashboard-stat-${label}`);
      const count = Number.parseInt(await card.locator("p").nth(1).innerText(), 10);
      await card.click();
      const details = page.getByRole("dialog", { name: `${label}明细` });
      await expect(details).toBeVisible();
      if (count > 0) {
        await expect(details.getByRole("link", { name: actionName })).toHaveCount(count);
      } else {
        await expect(details.getByText("当前没有需要处理的事项")).toBeVisible();
      }
      await details.getByRole("button", { name: "关闭待处理事项明细" }).click();
      await expect(details).toBeHidden();
    }
  });

  test("dashboard review approval updates the shared queue and summary", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await expect(page.getByTestId("dashboard-stat-待审核更新").locator("p").nth(1)).toContainText(
      "4",
    );
    await page.getByRole("link", { name: "快速核对" }).first().click();
    await expect(page).toHaveURL(/\/admin\/reviews\/REV-1001$/);
    await page.getByRole("button", { name: "审核通过" }).click();
    await expect(page.getByRole("button", { name: "确认通过" })).toBeDisabled();
    await page.getByLabel("已核对凭证与提交信息").check();
    await page.getByRole("button", { name: "确认通过" }).click();
    await expect(page.getByText("此申请已处理")).toBeVisible();
    await page.goto("/admin/dashboard");
    await expect(page.getByTestId("dashboard-stat-待审核更新").locator("p").nth(1)).toContainText(
      "3",
    );
  });

  test("question record can be searched, corrected and approved", async ({ page }) => {
    await page.goto("/admin/reviews");
    await page.getByLabel("AI 结果").selectOption("question");
    await expect(page).toHaveURL(/ai=question/);
    await page.getByLabel("搜索审核记录").first().fill("MOCK-1049");
    await page.getByRole("main").getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page).toHaveURL(/q=MOCK-1049/);
    await page.locator("a:visible").filter({ hasText: "快速核对" }).click();
    await expect(page).toHaveURL(/REV-1002$/);
    await page.getByRole("button", { name: /手动纠正/ }).click();
    const expiry = page.getByLabel("到期日期");
    await expiry.fill("2027-09-01");
    await page.getByLabel("签发机构").fill("人工核验后的示例机构");
    await page.getByRole("button", { name: "保存人工纠正" }).click();
    await expect(page.getByText("已人工修正")).toHaveCount(2);
    await page.getByRole("button", { name: /手动纠正/ }).click();
    await page.getByLabel("到期日期").fill("2027-08-31");
    await page.getByRole("button", { name: "保存人工纠正" }).click();
    await expect(page.getByText("已人工修正")).toHaveCount(1);
    const expiryRow = page
      .getByTestId("review-field-comparisons")
      .locator(":scope > div")
      .filter({ hasText: "到期日期" });
    await expect(expiryRow).toContainText("2027-08-31");
    await expect(expiryRow).not.toContainText("已人工修正");
    await page.getByRole("button", { name: /手动纠正/ }).click();
    await expect(page.getByRole("button", { name: "保存人工纠正" })).toBeDisabled();
    await page.getByRole("button", { name: "取消" }).click();
    await page.getByRole("button", { name: "审核通过" }).click();
    await page.getByLabel("已核对凭证与提交信息").check();
    await page.getByRole("button", { name: "确认通过" }).click();
    await expect(page.getByText("此申请已处理")).toBeVisible();
  });

  test("mismatch record validates return reason and survives refresh", async ({ page }) => {
    await page.goto("/admin/reviews/REV-1003");
    await page.getByRole("button", { name: "退回修改" }).click();
    await page.getByRole("button", { name: "确认退回" }).click();
    await expect(page.getByText("退回原因至少需要 5 个字符")).toBeVisible();
    await page.getByLabel("退回原因 *").fill("请重新上传完整且清晰的示例凭证");
    await page.getByRole("button", { name: "确认退回" }).click();
    await expect(page.getByText("此申请已处理")).toBeVisible();
    await page.reload();
    await expect(page.getByText("此申请已处理")).toBeVisible();
    await expect(page.getByText("已退回").first()).toBeVisible();
  });

  test("pilot search opens a detail with six qualifications and six stages", async ({ page }) => {
    await page.goto("/admin/pilots");
    await page.getByLabel("搜索姓名或员工号").first().fill("MOCK-1049");
    await page.getByRole("main").getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page).toHaveURL(/q=MOCK-1049/);
    await expect(page.getByRole("link", { name: "查看详情" })).toHaveCount(1);
    await page.getByRole("link", { name: "查看详情" }).click();
    await expect(page).toHaveURL(/pilot-demo-01$/);
    const desktopDetail = page.getByTestId("pilot-detail-desktop");
    for (const name of [
      "民用航空人员体检合格证",
      "机组年度复训合格证",
      "危险品运输培训合格证",
      "ICAO英语语言能力等级签注",
      "ICAO汉语语言能力等级签注",
      "模拟机复训（每6个月）",
    ]) {
      await expect(desktopDetail.getByText(name, { exact: false }).first()).toBeVisible();
    }
    for (const stage of [
      "理论口试",
      "中队评估",
      "大队评估",
      "模拟机检查",
      "航线检查",
      "实践考试",
    ]) {
      await expect(desktopDetail.getByText(stage, { exact: false }).first()).toBeVisible();
    }
  });

  test("pilot management creates one person and imports dynamic qualification CSV", async ({
    page,
  }) => {
    await page.goto("/admin/pilots");
    await page.getByRole("button", { name: "新增飞行员" }).click();
    const createDialog = page.getByRole("dialog");
    await createDialog.getByPlaceholder("例如 CQ-1049").fill("CQ-E2E-NEW");
    await createDialog.getByRole("textbox", { name: /^姓名/ }).fill("新增飞行员示例");
    await createDialog.getByPlaceholder("11 位手机号").fill("13800138881");
    await createDialog.getByPlaceholder("例如 A320").fill("A320");
    await createDialog.getByRole("combobox", { name: /^职务/ }).selectOption("副驾驶");
    await createDialog.getByPlaceholder("例如 CAPT-A / FO-2").fill("FO-2");
    await createDialog.getByRole("button", { name: "确认新增" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByLabel("搜索姓名或员工号").first().fill("CQ-E2E-NEW");
    await page.getByRole("main").getByRole("button", { name: "搜索", exact: true }).click();
    const pilotTable = page.getByRole("table");
    await expect(pilotTable.getByRole("cell", { name: "新增飞行员示例" })).toBeVisible();
    await expect(pilotTable.getByText("未建档")).toBeVisible();

    await page.getByRole("button", { name: "批量导入" }).click();
    const qualifications = qualificationDefinitions.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
    }));
    const headers = pilotCsvHeaders(qualifications);
    const firstQualification = qualificationDefinitions[0]!;
    const cells: Record<string, string> = {
      员工号: "CQ-E2E-CSV",
      姓名: "CSV飞行员示例",
      手机号: "13800138882",
      机型: "A320",
      职务: "机长",
      单位代码: "DEMO",
      人员级别代码: "CAPT-A",
      [`${firstQualification.name}｜开始日期`]: "2026-01-01",
      [`${firstQualification.name}｜截止日期`]: "2027-01-01",
      [`${firstQualification.name}｜级别`]: "IA级",
    };
    const csv = `${headers.join(",")}\n${headers.map((header) => cells[header] ?? "").join(",")}`;
    await page.getByLabel("选择飞行员 CSV 文件").setInputFiles({
      name: "pilots.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await expect(page.getByText("共 1 行 · 可导入 1 行 · 错误 0 行")).toBeVisible();
    await page.getByRole("button", { name: "导入 1 条有效记录" }).click();
    await expect(page.getByText("导入完成")).toBeVisible();
    await expect(page.getByText(/新增 1 人、写入 1 条资质/)).toBeVisible();
  });

  test("390x844 keeps mobile filters, decision bar and navigation usable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/reviews");
    await expect(page.getByTestId("mobile-header")).toBeVisible();
    await expect(page.getByTestId("mobile-bottom-nav")).toBeVisible();
    await page.getByRole("button", { name: "筛选" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "完成" }).click();
    await page.goto("/admin/reviews/REV-1004");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    const actionBox = await page.getByTestId("review-decision-bar").boundingBox();
    const navBox = await page.getByTestId("mobile-bottom-nav").boundingBox();
    expect(actionBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect((actionBox?.y ?? 0) + (actionBox?.height ?? 0)).toBeLessThanOrEqual(
      (navBox?.y ?? 0) + 1,
    );
  });

  test("1440x1024 shows desktop sidebar, topbar, tables and review columns", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.goto("/admin/reviews");
    await expect(page.getByTestId("desktop-sidebar")).toBeVisible();
    await expect(page.getByTestId("desktop-topbar")).toBeVisible();
    await expect(page.getByTestId("mobile-header")).toBeHidden();
    await expect(page.getByRole("table")).toBeVisible();
    await page.goto("/admin/reviews/REV-1001");
    const grid = await page
      .getByTestId("review-detail-grid")
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns);
    expect(grid.split(" ").length).toBeGreaterThanOrEqual(2);
  });

  test("all third-batch pages avoid uncaught and hydration errors", async ({ page }) => {
    const errors = captureRuntimeErrors(page);
    for (const route of [
      "/admin/dashboard",
      "/admin/pilots",
      "/admin/pilots/pilot-demo-01",
      "/admin/reviews",
      "/admin/reviews/REV-1001",
      "/dev/admin-review",
      "/admin/pilots/does-not-exist",
      "/admin/reviews/does-not-exist",
    ]) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
    }
    expect(errors).toEqual([]);
  });
});
