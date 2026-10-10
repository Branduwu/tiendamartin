import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { assertAccessibility, assertUsableViewport } from "./helpers";
type Fixture = {
  tenantId: string;
  owner: string;
  cashier: string;
  images: string;
  productFile: string;
};
const config = process.env.E2E_CAPTURE_FIXTURE;
const fixture: Fixture | null = config
  ? JSON.parse(readFileSync(config, "utf8"))
  : null;
test.beforeEach(() =>
  test.skip(!fixture, "Controlled capture fixture required"),
);
test.setTimeout(90000);
async function session(
  browser: Browser,
  role: "owner" | "cashier",
  project: string,
) {
  const c = await browser.newContext({
    storageState: fixture![role],
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    viewport:
      project === "desktop"
        ? { width: 1440, height: 900 }
        : project === "mobile"
          ? { width: 390, height: 844 }
          : { width: 360, height: 800 },
    hasTouch: project !== "desktop",
    isMobile: project !== "desktop",
  });
  return { context: c, page: await c.newPage() };
}
const url = (path: string) => `${path}?tenantId=${fixture!.tenantId}`;
async function mockCamera(
  context: BrowserContext,
  value: string,
  mode: "success" | "denied" | "empty" = "success",
) {
  await context.addInitScript(
    ({ value, mode }) => {
      const probe = { requested: 0, stopped: 0, detected: 0, facing: "" };
      Object.defineProperty(window, "captureProbe", { value: probe });
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async (constraints: {
            video: { facingMode: { ideal: string } };
          }) => {
            probe.requested++;
            probe.facing = constraints.video.facingMode.ideal;
            if (mode === "denied")
              throw new DOMException("denied", "NotAllowedError");
            const canvas = document.createElement("canvas");
            canvas.width = 640;
            canvas.height = 480;
            canvas.getContext("2d")!.fillRect(0, 0, 640, 480);
            const stream = canvas.captureStream(10);
            for (const track of stream.getTracks()) {
              const original = track.stop.bind(track);
              track.stop = () => {
                probe.stopped++;
                original();
              };
            }
            return stream;
          },
        },
      });
      class Detector {
        static async getSupportedFormats() {
          return [
            "ean_13",
            "ean_8",
            "upc_a",
            "upc_e",
            "code_128",
            "code_39",
            "qr_code",
          ];
        }
        async detect() {
          probe.detected++;
          return mode === "empty"
            ? []
            : [{ rawValue: value, format: "code_128" }];
        }
      }
      Object.defineProperty(window, "BarcodeDetector", {
        value: Detector,
        configurable: true,
      });
    },
    { value, mode },
  );
}
async function scanner(page: Page, button = "Escanear para buscar") {
  await page.getByRole("button", { name: button, exact: true }).click();
  const d = page.getByRole("dialog", { name: "Escanear producto" });
  await expect(d).toBeVisible();
  return d;
}
async function close(page: Page) {
  await page.getByRole("button", { name: "Cerrar diálogo" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}
async function localImages(context: BrowserContext) {
  if ((process.env.E2E_BASE_URL ?? "").startsWith("https:")) return;
  let saved: Buffer | null = null;
  let imageId: string | null = null;
  await context.route("**/api/v1/products/*/image*", async (r) => {
    if (r.request().method() === "PUT") {
      saved = r.request().postDataBuffer();
      imageId = crypto.randomUUID();
      await r.fulfill({
        json: { imageId },
      });
    } else if (r.request().method() === "DELETE") {
      saved = null;
      imageId = null;
      await r.fulfill({ json: { imageId } });
    } else if (r.request().url().includes("metadata=1"))
      await r.fulfill({
        json: {
          imageId,
        },
      });
    else if (saved) await r.fulfill({ contentType: "image/jpeg", body: saved });
    else await r.continue();
  });
}
test("product simulated camera prefills without saving, photo previews and persists", async ({
  browser,
}, info) => {
  const { context, page } = await session(browser, "owner", info.project.name),
    code = `SMOKE-D1-${info.project.name}-${Date.now()}`;
  try {
    await mockCamera(context, code);
    await localImages(context);
    await page.goto(url("/products"));
    await page
      .getByRole("button", { name: "Nuevo producto", exact: true })
      .click();
    await page.getByLabel("Nombre", { exact: true }).fill(code);
    await page.getByRole("textbox", { name: /^SKU/ }).fill(code.toUpperCase());
    const d = await scanner(page, "Escanear código");
    expect(await page.evaluate("window.captureProbe.requested")).toBe(0);
    await d
      .getByRole("button", { name: "Escanear con cámara", exact: true })
      .click();
    await expect(d.getByText(code, { exact: true })).toBeVisible();
    expect(await page.evaluate("window.captureProbe.facing")).toBe(
      "environment",
    );
    expect(await page.evaluate("window.captureProbe.stopped")).toBe(1);
    await d
      .getByRole("button", { name: "Usar este código", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: /Código de barras/ }),
    ).toHaveValue(code);
    await page
      .getByLabel("Seleccionar imagen", { exact: true })
      .setInputFiles(fixture!.images + "/EAN13.png");
    await expect(
      page.getByText("Vista previa. La foto se aplica al guardar el producto."),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Foto principal del producto" }),
    ).toBeVisible();
    await assertAccessibility(page);
    await assertUsableViewport(page);
    await page
      .getByRole("button", { name: "Guardar producto", exact: true })
      .click();
    await expect(
      page.getByText("Producto guardado.", { exact: true }),
    ).toBeVisible();
    const response = await context.request.get("/api/v1/products", {
      headers: { "x-tenant-id": fixture!.tenantId },
    });
    expect(response.status()).toBe(200);
    const data = (await response.json()) as {
      products: { id: string; name: string }[];
    };
    const id = data.products.find((p) => p.name === code)?.id;
    expect(id).toBeTruthy();
    writeFileSync(
      fixture!.productFile + "-" + info.project.name + ".json",
      JSON.stringify({ id, code }),
    );
    await page.reload();
    if (info.project.name !== "desktop")
      await page.getByLabel(`Más opciones de ${code}`, { exact: true }).click();
    await page
      .getByRole("button", { name: `Editar ${code}`, exact: true })
      .first()
      .click();
    const photo = page.getByRole("img", {
      name: "Foto principal del producto",
    });
    await expect(photo).toBeVisible();
    await expect
      .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await page.screenshot({
      path: info.outputPath("product-photo.png"),
      fullPage: true,
    });
    const metadata = () =>
      page.evaluate(
        async ({ id, tenantId }) => {
          const r = await fetch(
            `/api/v1/products/${id}/image?tenantId=${tenantId}&metadata=1`,
          );
          if (!r.ok) throw Error("Photo metadata failed");
          return r.json() as Promise<{ imageId: string | null }>;
        },
        { id: id!, tenantId: fixture!.tenantId },
      );
    const reopen = async () => {
      await page.reload();
      if (info.project.name !== "desktop")
        await page
          .getByLabel(`Más opciones de ${code}`, { exact: true })
          .click();
      await page
        .getByRole("button", { name: `Editar ${code}`, exact: true })
        .first()
        .click();
      await expect(
        page.getByLabel("Seleccionar imagen", { exact: true }),
      ).toBeEnabled();
    };
    const originalImage = (await metadata()).imageId;
    expect(originalImage).toBeTruthy();
    await expect(
      page.getByLabel("Seleccionar imagen", { exact: true }),
    ).toBeEnabled();
    await page
      .getByLabel("Seleccionar imagen", { exact: true })
      .setInputFiles(fixture!.images + "/EAN8.png");
    await expect(
      page.getByText("Vista previa. La foto se aplica al guardar el producto."),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Guardar producto", exact: true })
      .click();
    await expect(
      page.getByText("Producto guardado.", { exact: true }),
    ).toBeVisible();
    const replacement = (await metadata()).imageId;
    expect(replacement).toBeTruthy();
    expect(replacement).not.toBe(originalImage);
    await reopen();
    await expect(photo).toBeVisible();
    await expect
      .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await page
      .getByRole("button", { name: "Eliminar foto", exact: true })
      .click();
    expect((await metadata()).imageId).toBe(replacement);
    await page
      .getByRole("button", { name: "Guardar producto", exact: true })
      .click();
    await expect(
      page.getByText("Producto guardado.", { exact: true }),
    ).toBeVisible();
    expect((await metadata()).imageId).toBeNull();
    await reopen();
    await expect(
      page.getByText("Sin foto principal.", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Seleccionar imagen", { exact: true })
      .setInputFiles(fixture!.images + "/EAN13.png");
    await expect(
      page.getByText("Vista previa. La foto se aplica al guardar el producto."),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Guardar producto", exact: true })
      .click();
    await expect(
      page.getByText("Producto guardado.", { exact: true }),
    ).toBeVisible();
    expect((await metadata()).imageId).toBeTruthy();
    await reopen();
    await expect(photo).toBeVisible();
    await expect
      .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page
      .getByRole("button", { name: "Nuevo producto", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: /Código de barras/ }),
    ).toHaveValue("");
  } finally {
    await context.close();
  }
});
test("POS camera adds once, keyboard reader still adds and unknown offers creation only to owner", async ({
  browser,
}, info) => {
  const saved = JSON.parse(
    readFileSync(
      fixture!.productFile + "-" + info.project.name + ".json",
      "utf8",
    ),
  ) as { id: string; code: string };
  const { context, page } = await session(browser, "owner", info.project.name);
  try {
    await mockCamera(context, saved.code);
    await page.goto(url("/pos"));
    const d = await scanner(page, "Escanear");
    await d
      .getByRole("button", { name: "Escanear con cámara", exact: true })
      .click();
    await expect(d.getByText(saved.code, { exact: true })).toBeVisible();
    await d
      .getByRole("button", { name: "Usar este código", exact: true })
      .click();
    const quantity = page
      .locator(".pos-line")
      .filter({ hasText: saved.code })
      .getByRole("textbox", { name: "Cantidad (pza)" });
    if (info.project.name !== "desktop")
      await page.locator(".mobile-sale-bar").click();
    await expect(quantity).toHaveValue("1");
    expect(await page.evaluate("window.captureProbe.stopped")).toBe(1);
    if (info.project.name !== "desktop")
      await page.getByRole("button", { name: "Cerrar venta actual" }).click();
    await page
      .getByRole("textbox", { name: "Código de barras", exact: true })
      .fill(saved.code);
    await page
      .getByRole("textbox", { name: "Código de barras", exact: true })
      .press("Enter");
    if (info.project.name !== "desktop")
      await page.locator(".mobile-sale-bar").click();
    await expect(quantity).toHaveValue("2");
    await assertAccessibility(page);
    await assertUsableViewport(page);
    if (info.project.name !== "desktop")
      await page.getByRole("button", { name: "Cerrar venta actual" }).click();
    const unknown = "SMOKE-D1-UNKNOWN-" + Date.now();
    await page
      .getByRole("textbox", { name: "Código de barras", exact: true })
      .fill(unknown);
    await page
      .getByRole("textbox", { name: "Código de barras", exact: true })
      .press("Enter");
    await expect(
      page
        .getByText("No encontramos un producto con este código.", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    const create = page.getByRole("link", {
      name: /Crear producto con este código/,
    });
    await expect(create).toHaveAttribute("target", "_blank");
    const [newPage] = await Promise.all([
      context.waitForEvent("page"),
      create.click(),
    ]);
    await expect(
      newPage.getByRole("textbox", { name: /Código de barras/ }),
    ).toHaveValue(unknown);
    await page.screenshot({
      path: info.outputPath("pos-capture.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
test("image fallback reads seven formats and treats QR URL as inert text", async ({
  browser,
}, info) => {
  const { context, page } = await session(browser, "owner", info.project.name);
  let wasm = 0;
  page.on("request", (r) => {
    if (r.url().includes("/scanner-engine/reader.wasm")) wasm++;
  });
  try {
    await context.addInitScript(() =>
      Object.defineProperty(window, "BarcodeDetector", {
        value: undefined,
        configurable: true,
      }),
    );
    await page.goto(url("/products"));
    for (const [format, value] of [
      ["EAN13", "7501234567893"],
      ["EAN8", "12345670"],
      ["UPCA", "0012345678905"],
      ["UPCE", "01234565"],
      ["Code128", "SMOKE-D1-CODE128"],
      ["Code39", "SMOKE-D1"],
      ["QRCode", "https://example.com/untrusted"],
    ]) {
      const d = await scanner(page);
      if (format === "EAN13") expect(wasm).toBe(0);
      await d
        .getByLabel("Subir foto para leer código", { exact: true })
        .setInputFiles(fixture!.images + "/" + format + ".png");
      await expect(d.getByText(value!, { exact: true })).toBeVisible();
      if (format === "UPCA")
        await expect(
          d.getByRole("button", {
            name: "Usar equivalente UPC-A (012345678905)",
          }),
        ).toBeVisible();
      if (format === "QRCode") {
        expect(new URL(page.url()).pathname).toBe("/products");
        await expect(d.getByRole("status")).toContainText("✓ QR leído");
        await expect(
          d.getByRole("heading", { name: "✓ QR leído" }),
        ).toBeInViewport();
        await expect(d.getByText(/Este QR contiene un enlace\./)).toBeVisible();
        await expect(
          d.getByRole("button", { name: "Usar este código", exact: true }),
        ).toHaveCount(0);
        expect(context.pages()).toHaveLength(1);
        await assertAccessibility(page);
        await assertUsableViewport(page);
        await page.screenshot({
          path: info.outputPath("qr-safe.png"),
          fullPage: true,
        });
      }
      await close(page);
    }
    expect(wasm).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
test("denied or unsupported camera retains manual access and live close stops tracks", async ({
  browser,
}, info) => {
  const { context, page } = await session(browser, "owner", info.project.name);
  try {
    await mockCamera(context, "unused", "denied");
    await page.goto(url("/products"));
    let d = await scanner(page);
    await d
      .getByRole("button", { name: "Escanear con cámara", exact: true })
      .click();
    await expect(d.getByRole("status")).toContainText("permiso");
    await expect(
      d.getByRole("textbox", { name: "Escribir código manualmente" }),
    ).toBeVisible();
    await assertAccessibility(page);
    await assertUsableViewport(page);
    await close(page);
    await page.evaluate(() =>
      Object.defineProperty(navigator, "mediaDevices", {
        value: undefined,
        configurable: true,
      }),
    );
    d = await scanner(page);
    await d
      .getByRole("button", { name: "Escanear con cámara", exact: true })
      .click();
    await expect(d.getByRole("status")).toContainText("No pudimos acceder");
    await close(page);
  } finally {
    await context.close();
  }
  const live = await session(browser, "owner", info.project.name);
  try {
    await mockCamera(live.context, "unused", "empty");
    await live.page.goto(url("/products"));
    const d = await scanner(live.page);
    await d
      .getByRole("button", { name: "Escanear con cámara", exact: true })
      .click();
    await expect(d.getByRole("status")).toContainText("Buscando código…");
    await live.page.keyboard.press("Escape");
    await expect(d).not.toBeVisible();
    await expect
      .poll(() => live.page.evaluate("window.captureProbe.stopped"))
      .toBe(1);
    await expect(
      live.page.getByRole("button", {
        name: "Escanear para buscar",
        exact: true,
      }),
    ).toBeFocused();
    await live.page.setViewportSize({ width: 412, height: 915 });
    await scanner(live.page);
    await assertUsableViewport(live.page);
    await assertAccessibility(live.page);
    await live.page.emulateMedia({ colorScheme: "dark" });
    await expect(live.page.locator("html")).toHaveAttribute(
      "data-theme",
      "dark",
    );
    await assertAccessibility(live.page);
    await live.page.screenshot({
      path: info.outputPath("scanner-dark.png"),
      fullPage: true,
    });
    await live.page.setViewportSize({ width: 844, height: 390 });
    await assertUsableViewport(live.page);
  } finally {
    await live.context.close();
  }
});
test("cashier unknown code does not grant product or image editing", async ({
  browser,
}, info) => {
  const { context, page } = await session(
    browser,
    "cashier",
    info.project.name,
  );
  try {
    await page.goto(url("/pos"));
    const d = await scanner(page, "Escanear");
    await d
      .getByRole("textbox", { name: "Escribir código manualmente" })
      .fill("SMOKE-D1-UNKNOWN-" + Date.now());
    await d
      .getByRole("button", { name: "Usar código escrito", exact: true })
      .click();
    await expect(
      page
        .getByText("No encontramos un producto con este código.", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Crear producto con este código/ }),
    ).toHaveCount(0);
    const saved = JSON.parse(
      readFileSync(
        fixture!.productFile + "-" + info.project.name + ".json",
        "utf8",
      ),
    ) as { id: string };
    const r = await context.request.put(
      "/api/v1/products/" + saved.id + "/image",
      {
        headers: {
          origin: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
          "x-tenant-id": fixture!.tenantId,
          "x-product-image-version": "none",
          "content-type": "image/jpeg",
        },
        data: Buffer.from("not-image"),
      },
    );
    expect(r.status()).toBe(403);
    const foreign = await context.request.get(
      "/api/v1/products/" +
        saved.id +
        "/image?tenantId=550e8400-e29b-41d4-a716-446655440099",
    );
    expect(foreign.status()).toBe(403);
    await assertAccessibility(page);
    await assertUsableViewport(page);
  } finally {
    await context.close();
  }
});

test("photo processing blocks save and failed upload retries without duplicate product or lost preview", async ({
  browser,
}, info) => {
  const { context, page } = await session(browser, "owner", info.project.name);
  let creates = 0,
    uploads = 0;
  try {
    await localImages(context);
    await context.addInitScript(() => {
      const original = window.createImageBitmap.bind(window);
      const probe = { prepared: 0 };
      Object.defineProperty(window, "photoProbe", { value: probe });
      const encode = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
        encode.call(
          this,
          (blob) => {
            callback(blob);
            setTimeout(() => probe.prepared++, 0);
          },
          ...args,
        );
      };
      let release: () => void = () => {};
      Object.defineProperty(window, "releasePhoto", {
        value: () => release(),
        configurable: true,
      });
      window.createImageBitmap = async (
        ...args: Parameters<typeof createImageBitmap>
      ) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return original(...args);
      };
    });
    page.on("request", (r) => {
      if (
        r.method() === "POST" &&
        new URL(r.url()).pathname === "/api/v1/products"
      )
        creates++;
    });
    await context.route("**/api/v1/products/*/image*", async (r) => {
      if (r.request().method() === "PUT" && ++uploads === 1)
        await r.fulfill({
          status: 503,
          json: { error: "No pudimos guardar la foto." },
        });
      else await r.fallback();
    });
    await page.goto(url("/products"));
    await page
      .getByRole("button", { name: "Nuevo producto", exact: true })
      .click();
    const name = `SMOKE-D1-RETRY-${info.project.name}-${Date.now()}`;
    await page.getByLabel("Nombre", { exact: true }).fill(name);
    await page.getByRole("textbox", { name: /^SKU/ }).fill(name.toUpperCase());
    await page
      .getByLabel("Seleccionar imagen", { exact: true })
      .setInputFiles(fixture!.images + "/EAN13.png");
    await expect(
      page.getByText("Preparando foto…", { exact: true }),
    ).toBeVisible();
    const save = page.getByRole("button", {
      name: "Guardar producto",
      exact: true,
    });
    await expect(save).toBeDisabled();
    await save.evaluate((button: HTMLButtonElement) =>
      button.form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(creates).toBe(0);
    await page.evaluate("window.releasePhoto()");
    const preview = page.getByRole("img", {
      name: "Foto principal del producto",
    });
    await expect(preview).toBeVisible();
    const src = await preview.getAttribute("src");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(
      page.getByText(/Producto guardado; la foto no se pudo aplicar/),
    ).toBeVisible();
    await expect(preview).toHaveAttribute("src", src!);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(
      page.getByText("Producto guardado.", { exact: true }),
    ).toBeVisible();
    expect(creates).toBe(1);
    expect(uploads).toBe(2);
    await page
      .getByRole("button", { name: "Nuevo producto", exact: true })
      .click();
    await page
      .getByLabel("Seleccionar imagen", { exact: true })
      .setInputFiles(fixture!.images + "/EAN13.png");
    await expect(
      page.getByText("Preparando foto…", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.evaluate("window.releasePhoto()");
    await expect
      .poll(() => page.evaluate("window.photoProbe.prepared"))
      .toBe(2);
    await page
      .getByRole("button", { name: "Nuevo producto", exact: true })
      .click();
    await expect(
      page.getByText("Sin foto principal.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Foto principal del producto" }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
test("scan feedback is visible, accessible and unique across product and POS flows", async ({
  browser,
}, info) => {
  const { context, page } = await session(browser, "owner", info.project.name);
  const code = "SMOKE-FEEDBACK-ONE";
  const product = {
    id: "b8744a83-b964-419f-afd0-06e502554920",
    name: "SMOKE Feedback <b>literal</b>",
    sku: "SMOKE-FEEDBACK",
    barcode: code,
    unit: "piece",
    purchaseCost: { currency: "MXN", minorUnits: "100" },
    salePrice: { currency: "MXN", minorUnits: "250" },
    status: "active",
  };
  let lookups = 0,
    writes = 0;
  try {
    await mockCamera(context, code);
    await context.route("**/api/v1/products", async (r) => {
      if (r.request().method() !== "GET") {
        writes++;
        await r.abort();
        return;
      }
      await r.fulfill({ json: { products: [product] } });
    });
    await context.route("**/api/v1/products/lookup?*", async (r) => {
      lookups++;
      const value = new URL(r.request().url()).searchParams.get("barcode");
      await r.fulfill({
        json:
          value === code
            ? { status: "active", product }
            : { status: "not_found" },
      });
    });
    await page.goto(url("/products"));
    const d = await scanner(page);
    await d
      .getByRole("button", { name: "Escanear con cámara", exact: true })
      .click();
    await expect(d.getByRole("status")).toContainText("✓ Código detectado");
    await expect(d.locator(".scanner-viewfinder")).not.toBeVisible();
    await expect(
      d.getByRole("heading", { name: "✓ Código detectado" }),
    ).toBeInViewport();
    await d
      .getByRole("button", { name: "Usar este código", exact: true })
      .evaluate((button) => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    const feedback = page.locator(".scan-feedback");
    await expect(feedback).toContainText(
      "Producto encontrado: " + product.name,
    );
    await expect(feedback).toHaveCount(1);
    await expect(feedback).toHaveAttribute("aria-live", "polite");
    await expect(feedback).toHaveAttribute("aria-atomic", "true");
    await expect(feedback).toBeInViewport();
    expect(await feedback.locator("b").count()).toBe(0);
    await expect(feedback).toHaveCount(0, { timeout: 5000 });
    const unknownScanner = await scanner(page);
    await unknownScanner
      .getByLabel("Escribir código manualmente")
      .fill("SMOKE-UNKNOWN-FEEDBACK");
    await unknownScanner
      .getByRole("button", { name: "Usar código escrito" })
      .click();
    await expect(
      page.getByRole("button", { name: "Crear producto", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Escanear otro", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Buscar manualmente", exact: true })
      .click();
    await expect(
      page.getByRole("searchbox", { name: "Buscar productos" }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Nuevo producto", exact: true })
      .click();
    // Observe real live-region changes, including a fresh announcement for identical captures.
    await page
      .locator('[role="status"][aria-atomic="true"]')
      .first()
      .evaluate((region) => {
        const announcements: string[] = [];
        Object.defineProperty(window, "scanAnnouncements", {
          value: announcements,
        });
        new MutationObserver(() =>
          announcements.push(region.textContent ?? ""),
        ).observe(region, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      });
    const formScanner = await scanner(page, "Escanear código");
    await formScanner
      .getByRole("button", { name: "Escanear con cámara", exact: true })
      .click();
    await formScanner
      .getByRole("button", { name: "Usar este código", exact: true })
      .click();
    await expect(page.locator(".scan-feedback")).toContainText(
      "✓ Código capturado",
    );
    await expect(
      page.getByRole("textbox", { name: /Código de barras/ }),
    ).toHaveValue(code);
    const repeatedScanner = await scanner(page, "Escanear código");
    await repeatedScanner
      .getByRole("button", { name: "Escanear con cámara", exact: true })
      .click();
    await repeatedScanner
      .getByRole("button", { name: "Usar este código", exact: true })
      .click();
    await expect(page.locator(".scan-feedback")).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(
          "window.scanAnnouncements.filter(text => text.includes('✓ Código capturado')).length",
        ),
      )
      .toBe(2);
    expect(writes).toBe(0);
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.goto(url("/pos"));
    const posScanner = await scanner(page, "Escanear");
    await posScanner
      .getByRole("button", { name: "Escanear con cámara", exact: true })
      .click();
    await expect(posScanner.getByRole("status")).toContainText(
      "Código detectado",
    );
    await posScanner
      .getByRole("button", { name: "Usar este código", exact: true })
      .evaluate((button) => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    await expect(page.locator(".scan-feedback")).toHaveText(
      "✓ " + product.name + " agregado a la venta",
    );
    await expect(page.locator(".scan-feedback")).toBeInViewport();
    expect(lookups).toBe(1);
    if (info.project.name !== "desktop")
      await page.locator(".mobile-sale-bar").click();
    await expect(
      page
        .locator(".pos-line")
        .filter({ hasText: product.name })
        .getByRole("textbox", { name: "Cantidad (pza)" }),
    ).toHaveValue("1");
    if (info.project.name !== "desktop")
      await page.getByRole("button", { name: "Cerrar venta actual" }).click();
    const input = page.getByRole("textbox", {
      name: "Código de barras",
      exact: true,
    });
    await input.fill("SMOKE-UNKNOWN-FEEDBACK");
    await input.press("Enter");
    await expect(page.locator(".scan-feedback")).toContainText(
      "Código escaneado. No encontramos un producto",
    );
    await expect(
      page.getByRole("button", { name: "Escanear otro", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Buscar manualmente", exact: true })
      .click();
    await expect(input).toBeFocused();
    await expect(
      page.getByRole("link", { name: /Crear producto con este código/ }),
    ).toBeVisible();
    await assertAccessibility(page);
    await assertUsableViewport(page);
    await page.screenshot({
      path: info.outputPath("scan-feedback.png"),
      fullPage: true,
    });
    expect(lookups).toBe(2);
    expect(writes).toBe(0);
  } finally {
    await context.close();
  }
});
test("camera ignores printed numbers and codes outside the guide before a stable barcode", async ({
  browser,
}, info) => {
  const { context, page } = await session(browser, "owner", info.project.name);
  const png = readFileSync(fixture!.images + "/Code128.png").toString("base64");
  try {
    await context.addInitScript(
      ({ png }) => {
        Object.defineProperty(window, "BarcodeDetector", {
          value: undefined,
          configurable: true,
        });
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 960;
        const ctx = canvas.getContext("2d")!;
        const clear = () => {
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, 1280, 960);
          ctx.fillStyle = "black";
        };
        clear();
        ctx.font = "64px sans-serif";
        ctx.fillText("1234567890123", 360, 450);
        const probe = {
          requested: 0,
          stopped: 0,
          paint: async (stage: string) => {
            const image = new Image();
            image.src = "data:image/png;base64," + png;
            await image.decode();
            clear();
            const width = Math.min(1000, image.width),
              height = (image.height * width) / image.width;
            ctx.drawImage(
              image,
              (1280 - width) / 2,
              stage === "outside" ? 20 : 400,
              width,
              height,
            );
            ctx.font = "48px sans-serif";
            ctx.fillText("987654321", 430, 700);
          },
        };
        Object.defineProperty(window, "deliberateProbe", { value: probe });
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: {
            getUserMedia: async () => {
              probe.requested++;
              const stream = canvas.captureStream(12);
              const tick = setInterval(() => ctx.fillRect(0, 0, 1, 1), 80);
              for (const track of stream.getTracks()) {
                const stop = track.stop.bind(track);
                track.stop = () => {
                  probe.stopped++;
                  clearInterval(tick);
                  stop();
                };
              }
              return stream;
            },
          },
        });
      },
      { png },
    );
    await page.goto(url("/products"));
    const d = await scanner(page);
    await d
      .getByRole("button", { name: "Escanear con cámara", exact: true })
      .click();
    await expect(d.getByRole("status")).toContainText("Buscando código");
    // A bounded observation period ensures several real WASM frames see plain printed numbers.
    await page.waitForTimeout(1200);
    await expect(d.locator(".scanner-result")).toHaveCount(0);
    expect(await page.evaluate("window.deliberateProbe.stopped")).toBe(0);
    await page.evaluate("window.deliberateProbe.paint('outside')");
    await page.waitForTimeout(1200);
    await expect(d.locator(".scanner-result")).toHaveCount(0);
    expect(await page.evaluate("window.deliberateProbe.stopped")).toBe(0);
    await page.evaluate("window.deliberateProbe.paint('inside')");
    await expect(
      d.getByText("SMOKE-D1-CODE128", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate("window.deliberateProbe.stopped")).toBe(1);
    await expect(d.getByRole("status")).toContainText("✓ Código detectado");
    await assertAccessibility(page);
    await assertUsableViewport(page);
    await close(page);
  } finally {
    await context.close();
  }
});
