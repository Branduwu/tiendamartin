import { test, expect } from "@playwright/test";
import {
  login,
  hasCredentials,
  assertUsableViewport,
  assertAccessibility,
} from "./helpers";

test.describe("inventory thresholds", () => {
  test.skip(!hasCredentials, "Email/password absent; no embedded credentials");
  test("alerts remain accessible on the selected viewport", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/inventory/alerts");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: "Alertas de inventario", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await assertUsableViewport(page);
    await assertAccessibility(page);
  });
  test("existing SMOKE pair configures alerts and opens a draft without selecting a supplier", async ({
    page,
  }) => {
    const tenantId = process.env.E2E_SMOKE_TENANT_ID;
    const productId = process.env.E2E_SMOKE_PRODUCT_ID;
    const locationId = process.env.E2E_SMOKE_LOCATION_ID;
    test.skip(
      !tenantId || !productId || !locationId,
      "Explicit existing SMOKE pair required; never fabricate stock",
    );
    await login(page);
    const read = await page.request.get("/api/v1/inventory", {
      headers: { "x-tenant-id": tenantId! },
    });
    expect(read.status()).toBe(200);
    const row = (await read.json()).stock.find(
      (r: { productId: string; locationId: string }) =>
        r.productId === productId && r.locationId === locationId,
    );
    expect(row).toBeDefined();
    const previous = row.minimumStock ?? null;
    const amount = (BigInt(row.quantity.milliUnits) + 2000n).toString();
    const patch = (minimumStock: unknown) =>
      page.evaluate(
        async ({ tenantId, productId, locationId, minimumStock }) => {
          const r = await fetch("/api/v1/inventory/minimums", {
            method: "PATCH",
            headers: {
              "x-tenant-id": tenantId!,
              "content-type": "application/json",
            },
            body: JSON.stringify({ productId, locationId, minimumStock }),
          });
          return r.status;
        },
        { tenantId, productId, locationId, minimumStock },
      );
    try {
      expect(await patch({ unit: row.quantity.unit, milliUnits: amount })).toBe(
        200,
      );
      await page.goto(
        `/inventory/alerts?${new URLSearchParams({ tenantId: tenantId!, locationId: locationId! })}`,
      );
      await page.waitForLoadState("networkidle");
      expect(typeof row.sku).toBe("string");
      const alert = page.getByRole("row").filter({ hasText: row.sku });
      await expect(alert).toHaveCount(1);
      await expect(
        alert.getByText("Stock bajo", { exact: true }),
      ).toBeVisible();
      await assertUsableViewport(page);
      await assertAccessibility(page);
      await alert.getByRole("link", { name: /^Crear orden de compra/ }).click();
      await expect(
        page.getByRole("combobox", { name: /^Proveedor/ }),
      ).toHaveValue("");
      await expect(
        page.getByRole("combobox", { name: /^Producto/ }),
      ).toHaveValue(productId!);
      await expect(
        page.getByRole("combobox", { name: /^Ubicación/ }),
      ).toHaveValue(locationId!);
      await expect(
        page.getByRole("textbox", { name: "Cantidad pedida", exact: true }),
      ).toHaveValue("2.000");
      await assertUsableViewport(page);
      await assertAccessibility(page);
    } finally {
      expect(await patch(previous)).toBe(200);
    }
  });
});
