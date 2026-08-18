import { expect, test } from "@playwright/test";

test.describe("release core with external integrations disabled", () => {
  test("liveness and login entry remain available", async ({ page }) => {
    const liveness = await page.request.get("/api/health?probe=liveness");
    expect(liveness.status()).toBe(200);
    await page.goto("/admin/login");
    await expect(page.getByRole("heading", { name: "管理员安全登录" })).toBeVisible();
  });
});
