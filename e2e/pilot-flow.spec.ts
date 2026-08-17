import { expect, test } from "@playwright/test";

const mockImage = {
  name: "credential.png",
  mimeType: "image/png",
  buffer: Buffer.from("crewqual-local-preview"),
};

test.describe("pilot qualification flow", () => {
  test("identity to qualification update to submission receipt", async ({ page }) => {
    await page.goto("/pilot/identity");
    await page.getByLabel("员工工号").fill("CQ-1049");
    await page.getByLabel("登记手机号").fill("13800138000");
    await page.getByRole("button", { name: "发送访问链接" }).click();
    await expect(page).toHaveURL(/\/pilot\/qualifications$/);
    await expect(page.getByRole("heading", { name: "我的资质" })).toBeVisible();

    await page.getByRole("link", { name: /立即更新资质/ }).click();
    await expect(page).toHaveURL(/medical-certificate\/update$/);
    await page.getByTestId("credential-file").setInputFiles(mockImage);
    await expect(page.getByText("正在识别凭证日期")).toBeVisible();
    await expect(page.getByText("日期识别完成")).toBeVisible();

    await page.getByLabel("证件编号").fill("MOCK-CQ-E2E-01");
    await page.getByLabel("签发机构").fill("示例民航资质签发机构");
    await page.getByLabel("等级/参数").fill("合格（A级无限制）");
    await expect(page.getByLabel("签发日期")).toHaveValue("2026-01-09");
    await expect(page.getByLabel("到期日期")).toHaveValue("2026-10-09");
    await page.getByRole("button", { name: "提交更新" }).click();

    await expect(page).toHaveURL(/\/pilot\/submissions\/SUB-/);
    await expect(page.getByRole("heading", { name: "提交成功" })).toBeVisible();
    await expect(page.getByText("已提交至服务器")).toBeVisible();
    await expect(page.getByText("后台审核处理中")).toBeVisible();
    await expect(page.getByRole("heading", { name: "审核完成后通知" })).toBeVisible();
  });

  test("busy AI allows manual data and skip-to-submit", async ({ page }) => {
    await page.goto("/pilot/qualifications/medical-certificate/update?scenario=busy");
    await expect(page.getByText("AI识别系统繁忙")).toBeVisible();
    await page.getByLabel("证件编号").fill("MOCK-CQ-BUSY-01");
    await page.getByLabel("签发日期").fill("2026-02-01");
    await page.getByLabel("到期日期").fill("2026-11-01");
    await page.getByLabel("签发机构").fill("示例签发机构");
    await page.getByLabel("等级/参数").fill("手动填写");
    await page.getByRole("button", { name: "跳过并直接提交" }).click();
    await expect(page).toHaveURL(/\/pilot\/submissions\/SUB-/);
    await expect(page.getByRole("heading", { name: "提交成功" })).toBeVisible();
  });

  test("390x844 has no horizontal overflow and submit stays above the safe area", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pilot/qualifications/medical-certificate/update?scenario=recognized");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    const submit = page.getByRole("button", { name: "提交更新" });
    await expect(submit).toBeVisible();
    const box = await submit.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(844);
  });

  test("1440x1024 keeps the pilot content centered at max 430px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.goto("/pilot/qualifications");
    const box = await page.getByTestId("pilot-content-frame").boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width).toBeLessThanOrEqual(430);
    expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - 720)).toBeLessThanOrEqual(1);
  });

  test("development entry links every deterministic state", async ({ page }) => {
    await page.goto("/dev/pilot-flow");
    await expect(page.getByRole("heading", { name: "飞行员端闭环开发验收" })).toBeVisible();
    for (const scenario of [
      "recognizing",
      "recognized",
      "ambiguous",
      "conflict",
      "mismatch",
      "busy",
      "modified",
      "confirm",
    ]) {
      await expect(page.locator(`a[href*="scenario=${scenario}"]`)).toHaveCount(1);
    }
    await expect(page.locator("main a")).toHaveCount(11);
  });
});
