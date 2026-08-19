import { expect, test } from "@playwright/test";

test.describe("i18n language detection and switching", () => {
  test("uses browser English when no locale cookie exists", async ({ browser }) => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await page.goto("/deployment");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.getByRole("heading", { name: "Post-deployment checklist" })).toBeVisible();
    await context.close();
  });

  test("a manual switch persists and overrides browser language", async ({ browser }) => {
    const context = await browser.newContext({ locale: "zh-CN" });
    const page = await context.newPage();
    await page.goto("/deployment");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await page.getByRole("button", { name: "切换语言" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.getByRole("heading", { name: "Post-deployment checklist" })).toBeVisible();
    await context.close();
  });
});
