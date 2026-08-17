import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const productionPages = [
  "/admin/dashboard",
  "/admin/calendar?date=2026-08-14",
  "/admin/pilots",
  "/admin/pilots/pilot-demo-01",
  "/admin/qualification-config",
  "/admin/reviews",
  "/admin/reviews/REV-1001",
  "/admin/notifications",
  "/admin/settings",
  "/admin/upgrade-plans",
  "/admin/upgrade-plans/new",
  "/admin/upgrade-plans/upgrade-01",
  "/pilot/identity",
  "/pilot/qualifications",
  "/pilot/qualifications/medical-certificate/update?scenario=recognized",
];

function captureRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function assertNamedInteractiveControls(page: Page) {
  const unnamed = await page
    .locator("button:visible, a:visible, input:visible, select:visible, textarea:visible")
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const node = element as HTMLElement;
        const label =
          node.getAttribute("aria-label") ||
          (node.getAttribute("aria-labelledby")
            ? node
                .getAttribute("aria-labelledby")!
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent ?? "")
                .join(" ")
            : "") ||
          node.getAttribute("title") ||
          (node instanceof HTMLInputElement ||
          node instanceof HTMLSelectElement ||
          node instanceof HTMLTextAreaElement
            ? (node.labels?.[0]?.textContent ?? node.getAttribute("placeholder") ?? "")
            : (node.textContent ?? ""));
        return label.trim() ? [] : [{ tag: node.tagName, html: node.outerHTML.slice(0, 160) }];
      }),
    );
  expect(unnamed, "visible interactive controls must expose an accessible name").toEqual([]);
}

async function assertNoSeriousA11yViolations(page: Page) {
  await page.addScriptTag({ path: path.join(process.cwd(), "node_modules/axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const axe = (
      window as Window & {
        axe?: {
          run: () => Promise<{
            violations: Array<{
              id: string;
              impact: string | null;
              nodes: Array<{ target: string[] }>;
            }>;
          }>;
        };
      }
    ).axe;
    if (!axe) throw new Error("axe did not load");
    const result = await axe.run();
    return result.violations
      .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        targets: violation.nodes.map((node) => node.target),
      }));
  });
  expect(violations, "critical and serious axe violations").toEqual([]);
}

test.describe("production page responsive and accessibility smoke", () => {
  test("root entry opens the admin workspace in Mock mode", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("admin login fields are keyboard reachable", async ({ page }) => {
    await page.goto("/admin/login");
    await page.locator('[data-app-ready="true"]').waitFor();
    const email = page.getByLabel("电子邮箱地址");
    const password = page.getByLabel("密码");
    await email.focus();
    await expect(email).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(password).toBeFocused();
  });

  test("all production pages remain usable at mobile width with named controls", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = captureRuntimeErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of productionPages) {
      const routePage = await page.context().newPage();
      const routeErrors = captureRuntimeErrors(routePage);
      try {
        await routePage.setViewportSize({ width: 390, height: 844 });
        await routePage.goto(route);
        await expect(routePage.locator("main").first()).toBeVisible();
        await routePage.locator('[data-app-ready="true"]').waitFor();
        expect(
          await routePage.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(390);
        await assertNamedInteractiveControls(routePage);
      } finally {
        errors.push(...routeErrors);
        await routePage.close();
      }
    }
    expect(errors).toEqual([]);
  });

  test("all production pages remain usable at desktop width with keyboard focus", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = captureRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 1024 });
    for (const route of productionPages) {
      const routePage = await page.context().newPage();
      const routeErrors = captureRuntimeErrors(routePage);
      try {
        await routePage.setViewportSize({ width: 1440, height: 1024 });
        await routePage.goto(route);
        await expect(routePage.locator("main").first()).toBeVisible();
        await routePage.locator('[data-app-ready="true"]').waitFor();
        expect(
          await routePage.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(1440);
        await assertNamedInteractiveControls(routePage);
        await routePage.keyboard.press("Tab");
        await expect
          .poll(() => routePage.evaluate(() => document.activeElement?.tagName ?? "BODY"), {
            message: `keyboard focus did not leave BODY on ${route}`,
          })
          .not.toBe("BODY");
      } finally {
        errors.push(...routeErrors);
        await routePage.close();
      }
    }
    expect(errors).toEqual([]);
  });

  test("admin layout switches cleanly across the tablet breakpoint", async ({ page }) => {
    test.setTimeout(120_000);
    const viewports = [
      { width: 768, height: 1024 },
      { width: 1023, height: 900 },
      { width: 1024, height: 900 },
      { width: 1280, height: 900 },
    ];
    for (const viewport of viewports) {
      for (const route of [
        "/admin/calendar?date=2026-08-14",
        "/admin/upgrade-plans",
        "/admin/settings",
      ]) {
        const routePage = await page.context().newPage();
        try {
          await routePage.setViewportSize(viewport);
          await routePage.goto(route);
          await expect(routePage.locator("main").first()).toBeVisible();
          expect(
            await routePage.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(viewport.width);
          if (viewport.width < 1024) {
            await expect(routePage.getByTestId("mobile-bottom-nav")).toBeVisible();
            await expect(routePage.getByTestId("desktop-sidebar")).toBeHidden();
          } else {
            await expect(routePage.getByTestId("desktop-sidebar")).toBeVisible();
            await expect(routePage.getByTestId("mobile-bottom-nav")).toBeHidden();
          }
        } finally {
          await routePage.close();
        }
      }
    }
  });

  test("critical pilot action remains reachable in a short mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await page.goto("/pilot/qualifications/medical-certificate/update?scenario=busy");
    const submit = page.getByRole("button", { name: "跳过并直接提交" });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });

  test("production pages have no critical or serious axe violations", async ({ page }) => {
    test.setTimeout(120_000);
    for (const route of productionPages) {
      const routePage = await page.context().newPage();
      try {
        await routePage.setViewportSize({ width: 390, height: 844 });
        await routePage.goto(route);
        await expect(routePage.locator("main").first()).toBeVisible();
        await routePage.locator('[data-app-ready="true"]').waitFor();
        await assertNoSeriousA11yViolations(routePage);
      } finally {
        await routePage.close();
      }
    }
  });
});
