import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  login,
  hasCredentials,
  assertUsableViewport,
  assertAccessibility,
} from "./helpers";

const firstTenant = "10000000-0000-4000-8000-000000000001";
const secondTenant = "10000000-0000-4000-8000-000000000002";
const products = [1, 2, 3].map((index) => ({
  id: `20000000-0000-4000-8000-00000000000${index}`,
  name: `Producto de prueba ${index}`,
  sku: `LABEL-${index}`,
  ...(index < 3 ? { barcode: `750000000000${index}` } : {}),
  unit: "piece",
  status: "active",
  purchaseCost: { minorUnits: "100", currency: "MXN" },
  salePrice: { minorUnits: "1234", currency: "MXN" },
}));

async function companies(page: Page) {
  await page.route("**/api/v1/tenants", (route) =>
    route.fulfill({
      json: {
        tenants: [firstTenant, secondTenant].map((tenantId) => ({
          tenantId,
          permissions: ["products.read"],
        })),
      },
    }),
  );
}

function recordApiWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      path.startsWith("/api/v1/") &&
      !["GET", "HEAD"].includes(request.method())
    )
      writes.push(`${request.method()} ${path}`);
  });
  return writes;
}

async function dimensions(
  label: Locator,
  width: number,
  minimumHeight: number,
) {
  const mm = await label.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: (parseFloat(style.width) * 25.4) / 96,
      minimumHeight: (parseFloat(style.minHeight) * 25.4) / 96,
    };
  });
  expect(mm.width).toBeCloseTo(width, 1);
  expect(mm.minimumHeight).toBeCloseTo(minimumHeight, 1);
}

async function noVisibleUuids(page: Page) {
  expect(await page.locator("body").innerText()).not.toMatch(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
}

test.describe("labels UI with controlled read-only API responses", () => {
  test.skip(!hasCredentials, "Email/password absent; no embedded credentials");

  test("bounds selected copies, prints only the sheet and supports a small viewport", async ({
    page,
  }) => {
    await login(page);
    const writes = recordApiWrites(page);
    await companies(page);
    await page.route("**/api/v1/products", (route) =>
      route.fulfill({ json: { products } }),
    );
    await page.goto(
      `/labels?tenantId=${firstTenant}&productId=${products[0]!.id}`,
    );
    const sheet = page.locator(".label-sheet");
    await expect(sheet.locator("article")).toHaveCount(1);
    const firstLabel = sheet.locator("article").first();
    await expect(firstLabel.locator(".label-name")).toHaveText(
      products[0]!.name,
    );
    await expect(firstLabel.locator(".label-sku")).toHaveText(
      `SKU: ${products[0]!.sku}`,
    );
    await expect(firstLabel.locator(".label-price")).toHaveText("$12.34 MXN");
    await expect(firstLabel.locator("svg.label-barcode")).toHaveAttribute(
      "data-encoded-value",
      products[0]!.barcode!,
    );
    await dimensions(firstLabel, 70, 40);
    await noVisibleUuids(page);
    await page
      .getByRole("spinbutton", { name: `Copias de ${products[0]!.name}` })
      .fill("100");
    await expect(sheet.locator("article")).toHaveCount(100);
    await page
      .getByRole("combobox", { name: "Producto", exact: true })
      .selectOption(products[1]!.id);
    await page
      .getByRole("spinbutton", { name: "Cantidad de etiquetas", exact: true })
      .fill("100");
    await page.getByRole("button", { name: "Agregar etiquetas" }).click();
    await expect(sheet.locator("article")).toHaveCount(200);
    await page
      .getByRole("combobox", { name: "Producto", exact: true })
      .selectOption(products[2]!.id);
    await page
      .getByRole("spinbutton", { name: "Cantidad de etiquetas", exact: true })
      .fill("1");
    await page.getByRole("button", { name: "Agregar etiquetas" }).click();
    await expect(page.locator(".labels-page").getByRole("alert")).toContainText(
      "200",
    );
    await expect(
      page.getByRole("button", { name: "Imprimir etiquetas", exact: true }),
    ).toBeDisabled();
    await expect(sheet.locator("article")).toHaveCount(0);
    await page
      .getByRole("spinbutton", { name: `Copias de ${products[0]!.name}` })
      .fill("99");
    await expect(sheet.locator("article")).toHaveCount(199);
    await page.getByRole("button", { name: "Agregar etiquetas" }).click();
    await expect(sheet.locator("article")).toHaveCount(200);
    const missingBarcode = sheet.getByRole("article", {
      name: `Etiqueta de ${products[2]!.name}`,
    });
    await expect(missingBarcode.locator(".label-warning")).toContainText(
      "Sin código de barras",
    );
    await expect(missingBarcode.locator("svg")).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "Tamaño de etiqueta" })
      .selectOption("small");
    await dimensions(firstLabel, 50, 30);
    await expect(firstLabel.locator("svg.label-barcode")).toHaveAttribute(
      "data-encoded-value",
      products[0]!.barcode!,
    );
    await noVisibleUuids(page);
    await assertUsableViewport(page);
    await assertAccessibility(page);
    for (const [size, width, height] of [
      ["small", 50, 30],
      ["standard", 70, 40],
    ] as const) {
      await page.emulateMedia({ media: "screen" });
      await page
        .getByRole("combobox", { name: "Tamaño de etiqueta" })
        .selectOption(size);
      await page.emulateMedia({ media: "print" });
      await expect(page.locator(".topbar")).toBeHidden();
      expect(
        await page
          .locator(".labels-controls, nav, button, input, select")
          .evaluateAll((elements) =>
            elements.every((element) => !element.getClientRects().length),
          ),
      ).toBe(true);
      await expect(firstLabel).toBeVisible();
      await dimensions(firstLabel, width, height);
    }
    expect(writes, "labels must not write through the business API").toEqual(
      [],
    );
  });

  test("rejects foreign prefill and ignores a late response after switching company", async ({
    page,
  }) => {
    await login(page);
    const writes = recordApiWrites(page);
    await companies(page);
    await page.goto("/labels?tenantId=invalid&productId=invalid");
    await expect(page.locator(".labels-page").getByRole("alert")).toContainText(
      "El enlace de etiquetas no es válido",
    );
    await expect(
      page.getByRole("combobox", { name: "Empresa", exact: true }),
    ).toHaveValue("");
    await expect(page.locator(".label-sheet article")).toHaveCount(0);
    await noVisibleUuids(page);
    await page.goto("/labels?tenantId=30000000-0000-4000-8000-000000000003");
    await expect(page.locator(".labels-page").getByRole("alert")).toContainText(
      "No tienes acceso",
    );
    await expect(
      page.getByRole("combobox", { name: "Empresa", exact: true }),
    ).toHaveValue("");
    await expect(page.locator(".label-sheet article")).toHaveCount(0);
    await noVisibleUuids(page);
    let holdFirstTenant = false;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested!: () => void;
    const started = new Promise<void>((resolve) => {
      requested = resolve;
    });
    await page.route("**/api/v1/products", async (route) => {
      if (
        holdFirstTenant &&
        route.request().headers()["x-tenant-id"] === firstTenant
      ) {
        requested();
        await pending;
        await route.fulfill({ json: { products } }).catch(() => undefined);
      } else {
        await route.fulfill({
          json: {
            products:
              route.request().headers()["x-tenant-id"] === firstTenant
                ? products
                : [products[1]],
          },
        });
      }
    });
    await page.goto(
      `/labels?tenantId=${firstTenant}&productId=20000000-0000-4000-8000-000000000099`,
    );
    await expect(page.locator(".labels-page").getByRole("alert")).toContainText(
      "El producto solicitado no está disponible en esta empresa",
    );
    await expect(page.locator(".label-sheet article")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Imprimir etiquetas", exact: true }),
    ).toBeDisabled();
    await noVisibleUuids(page);
    holdFirstTenant = true;
    await page.goto(
      `/labels?tenantId=${firstTenant}&productId=${products[0]!.id}`,
    );
    await started;
    await page
      .getByRole("combobox", { name: "Empresa", exact: true })
      .selectOption(secondTenant);
    await expect(
      page.getByRole("combobox", { name: "Producto", exact: true }),
    ).toBeEnabled();
    release();
    await page
      .getByRole("combobox", { name: "Producto", exact: true })
      .selectOption(products[1]!.id);
    await page.getByRole("button", { name: "Agregar etiquetas" }).click();
    await expect(page.locator(".label-sheet article")).toHaveCount(1);
    await expect(page.locator(".label-sheet")).toContainText(products[1]!.name);
    await expect(page.locator(".label-sheet")).not.toContainText(
      products[0]!.name,
    );
    await expect(
      page.getByRole("combobox", { name: "Empresa", exact: true }),
    ).toHaveText(/Empresa 1.*Empresa 2/s);
    await noVisibleUuids(page);
    expect(writes, "labels must not write through the business API").toEqual(
      [],
    );
  });
});
