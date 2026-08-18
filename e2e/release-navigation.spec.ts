import { expect, test } from "@playwright/test";

test.describe("admin navigation", () => {
  test("admin login entry is reachable in production", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByRole("heading", { name: "管理员安全登录" })).toBeVisible();
  });
});
