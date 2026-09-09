import path from "node:path";
import { expect, test, type Page } from "./test-clock";

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

  for (const route of productionPages) {
    test(`mobile page has named controls and no overflow: ${route}`, async ({ page }) => {
      test.setTimeout(60_000);
      const errors = captureRuntimeErrors(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route);
      await expect(page.locator("main").first()).toBeVisible();
      await page.locator('[data-app-ready="true"]').waitFor();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
      await assertNamedInteractiveControls(page);
      expect(errors).toEqual([]);
    });
  }

  for (const route of productionPages) {
    test(`desktop page supports keyboard focus and no overflow: ${route}`, async ({ page }) => {
      test.setTimeout(60_000);
      const errors = captureRuntimeErrors(page);
      await page.setViewportSize({ width: 1440, height: 1024 });
      await page.goto(route);
      await expect(page.locator("main").first()).toBeVisible();
      await page.locator('[data-app-ready="true"]').waitFor();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        1440,
      );
      await assertNamedInteractiveControls(page);
      await page.keyboard.press("Tab");
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.tagName ?? "BODY"), {
          message: `keyboard focus did not leave BODY on ${route}`,
        })
        .not.toBe("BODY");
      expect(errors).toEqual([]);
    });
  }

  const tabletViewports = [
    { width: 768, height: 1024 },
    { width: 1023, height: 900 },
    { width: 1024, height: 900 },
    { width: 1280, height: 900 },
  ];
  const tabletRoutes = [
    "/admin/calendar?date=2026-08-14",
    "/admin/upgrade-plans",
    "/admin/settings",
  ];
  for (const viewport of tabletViewports) {
    for (const route of tabletRoutes) {
      test(`tablet layout ${viewport.width}px works on ${route}`, async ({ page }) => {
        test.setTimeout(60_000);
        await page.setViewportSize(viewport);
        await page.goto(route);
        await expect(page.locator("main").first()).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );
        if (viewport.width < 1024) {
          await expect(page.getByTestId("mobile-bottom-nav")).toBeVisible();
          await expect(page.getByTestId("desktop-sidebar")).toBeHidden();
        } else {
          await expect(page.getByTestId("desktop-sidebar")).toBeVisible();
          await expect(page.getByTestId("mobile-bottom-nav")).toBeHidden();
        }
      });
    }
  }

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

  for (const route of productionPages) {
    test(`page has no critical or serious axe violations: ${route}`, async ({ page }) => {
      test.setTimeout(60_000);
      // Browser init scripts are automation instrumentation and run before the
      // document's CSP applies. Injecting a script tag after navigation would
      // correctly be blocked by the production nonce policy.
      await page.addInitScript({
        path: path.join(process.cwd(), "node_modules/axe-core/axe.min.js"),
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route);
      await expect(page.locator("main").first()).toBeVisible();
      await page.locator('[data-app-ready="true"]').waitFor();
      await assertNoSeriousA11yViolations(page);
    });
  }
});
