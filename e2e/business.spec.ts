import { test, expect } from "@playwright/test";
import { assertUsableViewport, assertAccessibility } from "./helpers";
const state = process.env.E2E_STORAGE_STATE_PATH;
test.use({ ...(state ? { storageState: state } : {}) });
test.describe("TASK030 business context read-only smoke", () => {
  test.skip(!state, "Authorized ephemeral session not supplied");
  test("business settings and branch forms", async ({ page }) => {
    await page.goto("/settings/business");
    await expect(
      page.getByRole("button", { name: "Guardar negocio y ticket" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sucursales", exact: true }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await assertUsableViewport(page);
    await assertAccessibility(page);
  });
  test("POS shows current operational business and cashier", async ({
    page,
  }) => {
    await page.goto("/pos");
    await expect(
      page.getByRole("heading", { name: "Punto de venta", exact: true }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".company-context")).toContainText("Cajero:");
    await assertUsableViewport(page);
    await assertAccessibility(page);
  });
  test("ticket identifies business and branch", async ({ page }) => {
    test.skip(
      !process.env.E2E_SALE_ID || !process.env.E2E_TENANT_ID,
      "Existing sale fixture not supplied",
    );
    await page.goto(
      "/sales/" +
        process.env.E2E_SALE_ID +
        "?tenantId=" +
        process.env.E2E_TENANT_ID,
    );
    await expect(
      page.getByRole("heading", { name: "Ticket de venta", exact: true }),
    ).toBeVisible();
    await expect(page.locator("main.ticket")).toContainText("Sucursal:");
    await page.waitForLoadState("networkidle");
    await assertUsableViewport(page);
    await assertAccessibility(page);
  });
});
