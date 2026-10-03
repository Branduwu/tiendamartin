import { test, expect } from "@playwright/test";
import {
  assertAccessibility,
  assertNamedControls,
  assertUsableViewport,
  hasCredentials,
  login,
} from "./helpers";

const privateRoutes = [
  ["products", "/products", "Productos"],
  ["inventory", "/inventory", "Inventario"],
  ["pos", "/pos", "Punto de venta"],
  ["cash", "/cash", "Caja"],
  ["sales", "/sales", "Ventas"],
] as const;

test.describe("authenticated visual/read-only QA", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !hasCredentials,
      "Set E2E_EMAIL and E2E_PASSWORD for authenticated QA",
    );
    await login(page);
  });

  for (const [name, route, heading] of privateRoutes) {
    test(`${name} is navigable and visually stable`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await assertUsableViewport(page);
      await assertNamedControls(page);
      await assertAccessibility(page);
      await expect(page).toHaveScreenshot(`${name}.png`, {
        fullPage: true,
        animations: "disabled",
        mask: [page.locator(".tenant-id"), page.locator(".sale-id")],
      });
    });
  }

  test("keyboard navigation keeps focus visible on POS controls", async ({
    page,
  }) => {
    await page.goto("/pos");
    await expect(
      page.getByRole("heading", { name: "Punto de venta" }),
    ).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(":focus")).toBeVisible();
  });
});
