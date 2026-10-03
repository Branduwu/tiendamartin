import { test, expect } from "@playwright/test";
import {
  login,
  hasCredentials,
  assertUsableViewport,
  assertAccessibility,
  assertNamedControls,
} from "./helpers";
test.describe("customers read-only", () => {
  test.skip(
    !hasCredentials,
    "Email/password E2E variables not supplied; no embedded credentials",
  );
  test.beforeEach(async ({ page }) => {
    await login(page);
  });
  test("customer directory", async ({ page }) => {
    await page.goto("/customers");
    await page
      .getByRole("heading", { name: "Clientes", exact: true })
      .waitFor();
    await page.waitForLoadState("networkidle");
    await assertUsableViewport(page);
    await assertNamedControls(page);
    await assertAccessibility(page);
  });
  test("customer history", async ({ page }) => {
    test.skip(
      !process.env.E2E_CUSTOMER_ID || !process.env.E2E_TENANT_ID,
      "Customer fixture IDs not supplied",
    );
    await page.goto(
      "/customers/" +
        process.env.E2E_CUSTOMER_ID +
        "?tenantId=" +
        process.env.E2E_TENANT_ID,
    );
    await expect(
      page.getByRole("heading", { name: "Historial de compras" }),
    ).toBeVisible();
    await assertUsableViewport(page);
    await assertAccessibility(page);
  });
  test("POS optional customer", async ({ page }) => {
    await page.goto("/pos");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: "Cliente de la venta" }),
    ).toBeVisible();
    await expect(
      page.getByText("Público general", { exact: true }),
    ).toBeVisible();
    await assertUsableViewport(page);
    await assertNamedControls(page);
    await assertAccessibility(page);
  });
});
