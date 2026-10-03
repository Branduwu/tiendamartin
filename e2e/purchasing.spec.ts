import { test, expect } from "@playwright/test";
import {
  login,
  hasCredentials,
  assertUsableViewport,
  assertAccessibility,
  assertNamedControls,
} from "./helpers";
test.describe("purchasing read-only smoke", () => {
  test.skip(
    !hasCredentials,
    "E2E_EMAIL / E2E_PASSWORD not supplied; no credentials embedded",
  );
  test.beforeEach(async ({ page }) => {
    await login(page);
  });
  for (const [path, name] of [
    ["/suppliers", "Proveedores"],
    ["/purchases", "Compras"],
  ] as const) {
    test(`${name} list`, async ({ page }) => {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      await page.waitForLoadState("networkidle");
      await assertUsableViewport(page);
      await assertNamedControls(page);
      await assertAccessibility(page);
    });
  }
  test("purchase detail", async ({ page }) => {
    test.skip(
      !process.env.E2E_PURCHASE_ID || !process.env.E2E_TENANT_ID,
      "Read-only purchase fixture IDs not supplied",
    );
    await page.goto(
      `/purchases/${process.env.E2E_PURCHASE_ID}?tenantId=${process.env.E2E_TENANT_ID}`,
    );
    await expect(
      page.getByRole("heading", { name: "Líneas de la orden" }),
    ).toBeVisible();
    await assertUsableViewport(page);
    await assertNamedControls(page);
    await assertAccessibility(page);
  });
  test("receive form", async ({ page }) => {
    test.skip(
      !process.env.E2E_PURCHASE_ID || !process.env.E2E_TENANT_ID,
      "Ordered/partial read-only fixture IDs not supplied",
    );
    await page.goto(
      `/purchases/${process.env.E2E_PURCHASE_ID}?tenantId=${process.env.E2E_TENANT_ID}`,
    );
    await expect(
      page.getByRole("heading", { name: "Recibir mercancía" }),
    ).toBeVisible();
    await page
      .getByRole("heading", { name: "Recibir mercancía" })
      .scrollIntoViewIfNeeded();
    await assertUsableViewport(page);
    await assertNamedControls(page);
    await assertAccessibility(page);
  });
});
