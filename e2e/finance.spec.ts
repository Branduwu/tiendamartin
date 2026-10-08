import { test, expect } from "@playwright/test";
import { assertUsableViewport, assertAccessibility } from "./helpers";
const state = process.env.E2E_STORAGE_STATE_PATH;
test.use({ ...(state ? { storageState: state } : {}) });
test.describe("TASK029 financial read-only smoke", () => {
  test.skip(!state, "Authorized ephemeral session state not supplied");
  for (const [path, heading] of [
    ["/payables", "Cuentas por pagar"],
    ["/expenses", "Gastos"],
    ["/dashboard", "Dashboard"],
  ] as const) {
    test(heading, async ({ page }) => {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
      await page.waitForLoadState("networkidle");
      await assertUsableViewport(page);
      await assertAccessibility(page);
    });
  }
  test("supplier debt and purchase payment history", async ({ page }) => {
    test.skip(
      !process.env.E2E_SUPPLIER_ID ||
        !process.env.E2E_PAYABLE_ID ||
        !process.env.E2E_TENANT_ID,
      "SMOKE fixture IDs not supplied",
    );
    await page.goto(
      "/suppliers/" +
        process.env.E2E_SUPPLIER_ID +
        "?tenantId=" +
        process.env.E2E_TENANT_ID,
    );
    await expect(
      page.getByRole("heading", { name: "Historial del proveedor" }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await assertUsableViewport(page);
    await assertAccessibility(page);
    await page.goto(
      "/payables/" +
        process.env.E2E_PAYABLE_ID +
        "?tenantId=" +
        process.env.E2E_TENANT_ID,
    );
    await expect(
      page.getByRole("heading", { name: "Pagos realizados", exact: true }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await assertUsableViewport(page);
    await assertAccessibility(page);
  });
});
