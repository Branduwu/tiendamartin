import { test, expect, type Browser } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { assertAccessibility, assertUsableViewport } from "./helpers";
type Fixture = {
  tenantId: string;
  owner: string;
  cashier: string;
  supplierId: string;
  locationId: string;
  products: string[];
  files: string;
};
const config = process.env.E2E_DOCUMENT_FIXTURE;
const f: Fixture | null = config
  ? JSON.parse(readFileSync(config, "utf8"))
  : null;
test.beforeEach(() => test.skip(!f, "Controlled document fixture required"));
test.setTimeout(120000);
async function session(browser: Browser, project: string, cashier = false) {
  const context = await browser.newContext({
    storageState: cashier ? f!.cashier : f!.owner,
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    viewport:
      project === "desktop"
        ? { width: 1440, height: 900 }
        : { width: 360, height: 800 },
    hasTouch: project !== "desktop",
    isMobile: project !== "desktop",
  });
  return { context, page: await context.newPage() };
}
test("cancel photo preparation immediately and ignore its late result", async ({
  browser,
}, info) => {
  const { context, page } = await session(browser, info.project.name);
  try {
    await page.addInitScript(() => {
      const native = window.createImageBitmap.bind(window),
        controlled = window as Window & { releasePreparedImage?: () => void };
      let first = true;
      window.createImageBitmap = (async (
        image: ImageBitmapSource,
        options?: ImageBitmapOptions,
      ) => {
        const bitmap = await native(image, options);
        if (!first) return bitmap;
        first = false;
        return new Promise<ImageBitmap>((resolve) => {
          controlled.releasePreparedImage = () => {
            delete controlled.releasePreparedImage;
            resolve(bitmap);
          };
        });
      }) as typeof createImageBitmap;
    });
    await page.goto(`/purchases/capture?tenantId=${f!.tenantId}`);
    await expect(page.getByLabel("Tomar foto", { exact: true })).toBeEnabled();
    await page
      .getByLabel("Tomar foto", { exact: true })
      .setInputFiles(f!.files + "/iphone-portrait.jpg");
    await page.waitForFunction(() => "releasePreparedImage" in window);
    await page
      .getByRole("button", { name: "Cancelar preparación", exact: true })
      .click();
    await expect(page.getByLabel("Subir imagen o PDF")).toBeEnabled();
    await page
      .getByLabel("Subir imagen o PDF")
      .setInputFiles(f!.files + "/invoice.png");
    await expect(
      page.getByRole("button", { name: "Usar documento", exact: true }),
    ).toBeEnabled();
    await page.evaluate(async () => {
      (
        window as Window & { releasePreparedImage?: () => void }
      ).releasePreparedImage?.();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    await expect(page.locator(".document-filename")).toHaveText("invoice.png");
    await expect(
      page.getByRole("button", { name: "Usar documento", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByText(
        "Copia optimizada para leer y guardar. La foto original permanece en tu dispositivo.",
      ),
    ).toHaveCount(0);
    await assertAccessibility(page);
    await assertUsableViewport(page);
  } finally {
    await context.close();
  }
});
test("phone photo over 12 MP is optimized, oriented, reviewed and stored privately", async ({
  browser,
}, info) => {
  const { context, page } = await session(browser, info.project.name);
  try {
    await page.addInitScript(() => {
      const native = window.fetch.bind(window),
        controlled = window as Window & {
          documentUpload?: Promise<{ size: number; hash: string }>;
        };
      window.fetch = (input, init) => {
        if (
          String(input).endsWith("/api/v1/purchases/document") &&
          init?.method === "POST" &&
          init.body instanceof Blob
        ) {
          const body = init.body;
          controlled.documentUpload = body
            .arrayBuffer()
            .then(async (bytes) => ({
              size: body.size,
              hash: Array.from(
                new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
                (value) => value.toString(16).padStart(2, "0"),
              ).join(""),
            }));
        }
        return native(input, init);
      };
    });
    const headers = { "x-tenant-id": f!.tenantId };
    const before = await (
      await context.request.get("/api/v1/inventory", { headers })
    ).json();
    let validations = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/v1/purchases/document")) validations++;
    });
    await page.goto(`/purchases/capture?tenantId=${f!.tenantId}`);
    await expect(page.getByLabel("Tomar foto", { exact: true })).toBeEnabled();
    await page
      .getByLabel("Tomar foto", { exact: true })
      .setInputFiles(f!.files + "/iphone-portrait.jpg");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Foto ajustada automáticamente" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Copia optimizada para leer y guardar. La foto original permanece en tu dispositivo.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Usar documento", exact: true }),
    ).toBeEnabled();
    const dimensions = await page
      .locator(".document-preview canvas")
      .evaluate((canvas: HTMLCanvasElement) => ({
        width: canvas.width,
        height: canvas.height,
      }));
    expect(dimensions.height).toBeGreaterThan(dimensions.width);
    expect(validations).toBe(0);
    const validate = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/purchases/document") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Usar documento", exact: true })
      .click();
    const validated = await validate;
    expect(validated.status()).toBe(200);
    expect(validated.request().headers()["content-type"]).toBe("image/jpeg");
    // CDP does not expose file-backed POST bytes; observe the actual File hash,
    // then compare against the normal authenticated download without mocking IO.
    const normalized = await page.evaluate(
      () =>
        (
          window as Window & {
            documentUpload?: Promise<{ size: number; hash: string }>;
          }
        ).documentUpload,
    );
    expect(normalized!.size).toBeLessThanOrEqual(4194304);
    await expect(
      page.getByRole("heading", { name: "Revisa los datos detectados" }),
    ).toBeVisible();
    await expect(page.getByLabel("Producto de la línea 2")).toBeVisible();
    await page
      .getByRole("combobox", { name: /^Proveedor/ })
      .selectOption(f!.supplierId);
    await page
      .getByRole("combobox", { name: /^Sucursal/ })
      .selectOption(f!.locationId);
    for (let i = 0; i < 2; i++) {
      await page
        .getByLabel("Producto de la línea " + (i + 1))
        .selectOption(f!.products[i]!);
      await page
        .getByLabel("Confirmo el producto de esta línea")
        .nth(i)
        .check();
    }
    await page.getByLabel("Costo unitario (MXN)").nth(0).fill("26.00");
    const cloudStorage = (process.env.E2E_BASE_URL ?? "").startsWith("https:");
    await expect(
      page.getByLabel("Guardar la copia optimizada privada junto a la compra"),
    ).toBeVisible();
    // The disposable local database deliberately has no privileged cloud key.
    if (cloudStorage)
      await page
        .getByLabel("Guardar la copia optimizada privada junto a la compra")
        .check();
    await page
      .getByLabel(
        "Revisé proveedor, productos, unidades, costos y advertencias. Crearé un borrador, sin modificar inventario.",
      )
      .check();
    await assertAccessibility(page);
    await assertUsableViewport(page);
    const created = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/purchases") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Crear borrador de compra", exact: true })
      .click();
    const result = await (await created).json();
    await expect(
      page.getByRole("heading", { name: "Borrador creado", exact: true }),
    ).toBeVisible();
    if (cloudStorage) {
      const document = await context.request.get(
        `/api/v1/purchases/${result.purchase.id}/document`,
        { headers },
      );
      expect(document.status()).toBe(200);
      const stored = await document.body();
      expect(stored.length).toBe(normalized!.size);
      expect(stored.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
      expect(createHash("sha256").update(stored).digest("hex")).toBe(
        normalized!.hash,
      );
    }
    expect(
      await (
        await context.request.get("/api/v1/inventory", { headers })
      ).json(),
    ).toEqual(before);
  } finally {
    await context.close();
  }
});
test("PDF text preview, human correction, draft and ledger unchanged; no OCR", async ({
  browser,
}, info) => {
  const { context, page } = await session(browser, info.project.name);
  try {
    let ocr = 0,
      create = 0;
    page.on("request", (r) => {
      if (r.url().includes("ocr-worker")) ocr++;
      if (r.url().endsWith("/api/v1/purchases") && r.method() === "POST")
        create++;
    });
    await page.goto(`/purchases/capture?tenantId=${f!.tenantId}`);
    const beforeStock = await (
      await context.request.get("/api/v1/inventory", {
        headers: { "x-tenant-id": f!.tenantId },
      })
    ).json();
    await expect(page.getByLabel("Subir imagen o PDF")).toBeEnabled();
    await page
      .getByLabel("Subir imagen o PDF")
      .setInputFiles(f!.files + "/text.pdf");
    await expect(
      page.getByRole("button", { name: "Usar documento" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("heading", { name: "Revisa los datos detectados" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Usar documento" }).click();
    await expect(
      page.getByRole("heading", { name: "Revisa los datos detectados" }),
    ).toBeVisible();
    await expect(
      page.getByText("Lectura: PDF texto. Todos los valores son propuestas."),
    ).toBeVisible();
    expect(ocr).toBe(0);
    expect(create).toBe(0);
    expect(
      await (
        await context.request.get("/api/v1/inventory", {
          headers: { "x-tenant-id": f!.tenantId },
        })
      ).json(),
    ).toEqual(beforeStock);
    await page
      .getByRole("combobox", { name: /^Proveedor/ })
      .selectOption(f!.supplierId);
    await page
      .getByRole("combobox", { name: /^Sucursal/ })
      .selectOption(f!.locationId);
    await page
      .getByLabel("Producto de la línea 1")
      .selectOption(f!.products[0]!);
    await page
      .getByLabel("Producto de la línea 2")
      .selectOption(f!.products[1]!);
    await page.getByLabel("Confirmo el producto de esta línea").nth(0).check();
    await page.getByLabel("Confirmo el producto de esta línea").nth(1).check();
    await page.getByLabel("Costo unitario (MXN)").nth(0).fill("26.00");
    await expect(
      page.getByText(
        "Línea 1: cantidad × costo no coincide con el importe detectado.",
      ),
    ).toBeVisible();
    await assertAccessibility(page);
    await assertUsableViewport(page);
    await page
      .getByLabel(
        "Revisé proveedor, productos, unidades, costos y advertencias. Crearé un borrador, sin modificar inventario.",
      )
      .check();
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/purchases") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Crear borrador de compra", exact: true })
      .dblclick();
    const result = await (await response).json();
    await expect(
      page.getByRole("heading", { name: "Borrador creado", exact: true }),
    ).toBeVisible();
    expect(create).toBe(1);
    expect(result.purchase.status).toBe("draft");
    expect(
      await (
        await context.request.get("/api/v1/inventory", {
          headers: { "x-tenant-id": f!.tenantId },
        })
      ).json(),
    ).toEqual(beforeStock);
    expect(
      result.purchase.lines.find(
        (l: { productId: string }) => l.productId === f!.products[0],
      ).unitCost.minorUnits,
    ).toBe("2600");
    await page
      .getByRole("link", { name: "Ver compra / recibir mercancía" })
      .click();
    await expect(
      page.getByText("Documento: SMOKE-001 · 2026-10-10"),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
test("image OCR extracts lines, corrections stay editable and cancel creates nothing", async ({
  browser,
}, info) => {
  const { context, page } = await session(browser, info.project.name);
  try {
    let writes = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/v1/purchases") && r.method() === "POST")
        writes++;
    });
    await page.goto(`/purchases/capture?tenantId=${f!.tenantId}`);
    await expect(page.getByLabel("Subir imagen o PDF")).toBeEnabled();
    await page
      .getByLabel("Subir imagen o PDF")
      .setInputFiles(f!.files + "/invoice.png");
    await expect(
      page.getByRole("button", { name: "Usar documento" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Usar documento" }).click();
    await expect(
      page.getByRole("heading", { name: "Revisa los datos detectados" }),
    ).toBeVisible({ timeout: 90000 });
    await expect(
      page.getByText("Lectura: OCR. Todos los valores son propuestas."),
    ).toBeVisible();
    await expect(page.getByLabel("Cantidad").nth(0)).toHaveValue("2.000");
    await page.getByLabel("Cantidad").nth(0).fill("4");
    await expect(page.getByLabel("Cantidad").nth(0)).toHaveValue("4");
    await page
      .getByRole("button", { name: "Cancelar revisión", exact: true })
      .click();
    await expect(
      page.getByText("Revisión cancelada. No se creó ninguna compra."),
    ).toBeVisible();
    expect(writes).toBe(0);
  } finally {
    await context.close();
  }
});
test("cashier cannot capture documents or create purchase", async ({
  browser,
}, info) => {
  const { context, page } = await session(browser, info.project.name, true);
  try {
    await page.goto(`/purchases/capture?tenantId=${f!.tenantId}`);
    await expect(
      page.getByRole("heading", { name: "Captura no disponible" }),
    ).toBeVisible();
    const response = await context.request.post("/api/v1/purchases/document", {
      headers: {
        "x-tenant-id": f!.tenantId,
        origin: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
        "content-type": "image/png",
      },
      data: readFileSync(f!.files + "/invoice.png"),
    });
    expect(response.status()).toBe(403);
  } finally {
    await context.close();
  }
});

test("scanned PDF uses OCR and multipage preview remains available", async ({
  browser,
}, info) => {
  const { context, page } = await session(browser, info.project.name);
  try {
    await page.goto(`/purchases/capture?tenantId=${f!.tenantId}`);
    await expect(page.getByLabel("Subir imagen o PDF")).toBeEnabled();
    await page
      .getByLabel("Subir imagen o PDF")
      .setInputFiles(f!.files + "/scanned.pdf");
    await expect(
      page.getByRole("button", { name: "Usar documento" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Usar documento" }).click();
    await expect(
      page.getByRole("heading", { name: "Revisa los datos detectados" }),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByText("Lectura: OCR. Todos los valores son propuestas."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancelar revisión" }).click();
    await page
      .getByLabel("Subir imagen o PDF")
      .setInputFiles(f!.files + "/multipage.pdf");
    await expect(
      page.getByText("Página 1 de 2. Se leen todas las páginas permitidas."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Página siguiente" }).click();
    await expect(
      page.getByText("Página 2 de 2. Se leen todas las páginas permitidas."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Usar documento" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Usar documento" }).click();
    await expect(page.getByRole("textbox", { name: /^Cantidad/ })).toHaveCount(
      2,
    );
    await expect(
      page.getByRole("button", { name: "Página anterior" }),
    ).toBeEnabled();
  } finally {
    await context.close();
  }
});

test("create missing product explicitly, return to review, confirm and create image draft", async ({
  browser,
}, info) => {
  const { context, page } = await session(browser, info.project.name);
  try {
    await page.goto(`/purchases/capture?tenantId=${f!.tenantId}`);
    await expect(page.getByLabel("Subir imagen o PDF")).toBeEnabled();
    await page
      .getByLabel("Subir imagen o PDF")
      .setInputFiles(f!.files + "/invoice.png");
    await expect(
      page.getByRole("button", { name: "Usar documento" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Usar documento" }).click();
    await expect(
      page.getByRole("heading", { name: "Revisa los datos detectados" }),
    ).toBeVisible({ timeout: 60000 });
    await page
      .getByRole("button", { name: "Crear producto para esta línea" })
      .nth(0)
      .click();
    const modal = page.getByRole("dialog", {
      name: "Crear producto desde documento",
    });
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel("Precio (MXN)")).toHaveValue("");
    await expect(modal.getByLabel("Costo (MXN)")).toHaveValue("25.50");
    await modal
      .getByLabel("Nombre", { exact: true })
      .fill("SMOKE Documento Producto Nuevo");
    await modal.getByLabel(/^SKU/).fill("SMOKE-D2-" + Date.now());
    await modal.getByLabel("Precio (MXN)").fill("40.00");
    await modal
      .getByRole("button", { name: "Guardar producto", exact: true })
      .click();
    await expect(modal).not.toBeVisible();
    await expect(
      page.getByLabel("Confirmo el producto de esta línea").nth(0),
    ).not.toBeChecked();
    await page.getByLabel("Confirmo el producto de esta línea").nth(0).check();
    await page
      .getByLabel("Producto de la línea 2")
      .selectOption(f!.products[1]!);
    await page.getByLabel("Confirmo el producto de esta línea").nth(1).check();
    await page
      .getByRole("combobox", { name: /^Proveedor/ })
      .selectOption(f!.supplierId);
    await page
      .getByRole("combobox", { name: /^Sucursal/ })
      .selectOption(f!.locationId);
    await page
      .getByLabel(
        "Revisé proveedor, productos, unidades, costos y advertencias. Crearé un borrador, sin modificar inventario.",
      )
      .check();
    await assertAccessibility(page);
    await assertUsableViewport(page);
    await page
      .getByRole("button", { name: "Crear borrador de compra", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Borrador creado", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
