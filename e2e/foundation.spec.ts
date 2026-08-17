import { expect, test } from "@playwright/test";

test.describe("CrewQual foundation", () => {
  test("UI Kit has no horizontal overflow at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dev/ui-kit");
    await expect(page).toHaveTitle(/UI Kit/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });

  test("UI Kit keeps a wide desktop layout at 1440px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.goto("/dev/ui-kit");
    await expect(page.getByRole("heading", { name: "UI Kit 设计系统验收" })).toBeVisible();
    await expect(page.getByRole("button", { name: "打开 Dialog" })).toBeVisible();
  });

  test("Admin switches navigation by breakpoint", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dev/layout-preview");
    await expect(page.getByTestId("mobile-header")).toBeVisible();
    await expect(page.getByTestId("mobile-bottom-nav")).toBeVisible();
    await expect(page.getByTestId("desktop-sidebar")).toBeHidden();

    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.reload();
    await expect(page.getByTestId("desktop-sidebar")).toBeVisible();
    await expect(page.getByTestId("desktop-topbar")).toBeVisible();
    await expect(page.getByTestId("mobile-header")).toBeHidden();
  });

  test("mobile drawer opens, closes and responds to Escape", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dev/layout-preview");
    const drawer = page.getByTestId("mobile-drawer");
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await page.getByRole("button", { name: "打开菜单" }).click();
    await expect(drawer).toBeVisible();
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(drawer).toBeHidden();
  });

  test("bottom navigation leaves the final preview content unobscured", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dev/layout-preview");
    await page.getByTestId("last-preview-content").scrollIntoViewIfNeeded();
    const contentBox = await page.getByTestId("last-preview-content").boundingBox();
    const navBox = await page.getByTestId("mobile-bottom-nav").boundingBox();
    expect(contentBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect((contentBox?.y ?? 0) + (contentBox?.height ?? 0)).toBeLessThanOrEqual(navBox?.y ?? 0);
  });
});
