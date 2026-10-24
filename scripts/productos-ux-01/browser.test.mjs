// Real ProductsPanel/contracts/display/controls. Services and transactions are synthetic.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { build } = await import(
  pathToFileURL(
    require.resolve("vite", {
      paths: [path.dirname(require.resolve("vitest/package.json"))],
    }),
  ).href
);
const { chromium } = require(
  require.resolve("playwright", {
    paths: [path.dirname(require.resolve("@playwright/test/package.json"))],
  }),
);
const root = process.cwd(),
  fixture = path.join(root, "scripts/productos-ux-01");
const result = await build({
  plugins: [
    {
      name: "isolated-next-boundaries",
      resolveId(id) {
        if (id.startsWith("virtual:")) return id;
      },
      load(id) {
        if (!id.startsWith("virtual:")) return;
        const file = JSON.stringify(path.join(fixture, "shims.tsx"));
        const names = {
          "virtual:nav": "Navigation as default,companyLabel",
          "virtual:auth": "browserAuth",
          "virtual:image": "Image as default",
          "virtual:dynamic": "dynamic as default",
        };
        return `export {${names[id]}} from ${file}`;
      },
    },
  ],
  configFile: false,
  envDir: false,
  root,
  logLevel: "silent",
  resolve: {
    alias: [
      { find: "next/link", replacement: path.join(fixture, "shims.tsx") },
      { find: "next/navigation", replacement: path.join(fixture, "shims.tsx") },
      { find: "../components/app-navigation", replacement: "virtual:nav" },
      { find: "../../lib/supabase/client", replacement: "virtual:auth" },
      { find: "next/image", replacement: "virtual:image" },
      { find: "next/dynamic", replacement: "virtual:dynamic" },
      {
        find: "react-dom",
        replacement: path.join(root, "apps/web/node_modules/react-dom"),
      },
      {
        find: "react",
        replacement: path.join(root, "apps/web/node_modules/react"),
      },
    ],
  },
  define: { "process.env.NODE_ENV": '"development"' },
  build: {
    write: false,
    minify: false,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: path.join(fixture, "fixture.tsx"),
      name: "ProductFixture",
      formats: ["iife"],
    },
  },
});
const outputs = (Array.isArray(result) ? result[0] : result).output,
  chunk = outputs.find((x) => x.type === "chunk"),
  css = outputs
    .filter((x) => x.type === "asset" && x.fileName.endsWith(".css"))
    .map((x) => x.source)
    .join("\n");
assert.ok(chunk && css);
assert.ok(
  !Object.keys(chunk.modules).some((x) =>
    /@supabase\/|\/next\/dist\//.test(x.replaceAll("\\", "/")),
  ),
);
const html = `<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body class="retail-ui"><div id="root"></div><script>${chunk.code.replaceAll("</script", "<\\/script")}</script></body></html>`;

const uid = (n) => `550e8400-e29b-41d4-a716-${String(n).padStart(12, "0")}`;
const tenant = uid(1),
  money = (n) => ({ currency: "MXN", minorUnits: String(n) });
const product = (n, fields = {}) => ({
  id: uid(40 + n),
  name:
    ["Café molido del Centro", "Arroz a granel", "Producto inactivo"][n - 1] ??
    "Producto",
  sku: `PROD-${n}`,
  barcode: `750000000000${n}`,
  unit: n === 2 ? "kg" : "piece",
  purchaseCost: money(2050),
  salePrice: money(3550),
  status: n === 3 ? "inactive" : "active",
  ...fields,
});
const browser = await chromium.launch({ headless: true });
let checks = 0,
  externalRequests = 0;
const pass = (name) => {
  checks++;
  console.log(JSON.stringify({ name, result: "PASS" }));
};
async function session({
  mode = "normal",
  width = 1440,
  height = 1000,
  canWrite = true,
} = {}) {
  const context = await browser.newContext({ viewport: { width, height } }),
    page = await context.newPage(),
    calls = [],
    errors = [];
  let failRead = mode === "read-error",
    taxFail = mode === "tax-error",
    saveFail = false,
    holdSave = null,
    releaseSave = null;
  let products = mode === "empty" ? [] : [product(1), product(2), product(3)];
  page.on("pageerror", (e) => errors.push(e.message));
  const address = "http://127.0.0.1:55996/";
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url === address)
      return route.fulfill({ contentType: "text/html", body: html });
    if (url.startsWith(address + "api/v1/products/") && url.includes("/image?"))
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    externalRequests++;
    return route.abort();
  });
  await page.exposeFunction("productMock", async (url, init) => {
    calls.push({ url, ...init });
    const ok = (body) => ({ status: 200, body });
    if (url === "/api/v1/tenants")
      return ok({
        tenants: [
          {
            tenantId: tenant,
            tenantName: "Empresa ficticia",
            canWriteProducts: canWrite,
            permissions: [
              "products.read",
              ...(canWrite ? ["products.write"] : []),
            ],
          },
        ],
      });
    if (url === "/api/v1/product-images")
      return ok({
        images: products.length
          ? [{ productId: products[0].id, imageId: uid(91) }]
          : [],
      });
    if (url.includes("/image?") && url.includes("metadata=1"))
      return ok({ imageId: null });
    if (url === "/api/v1/taxes")
      return taxFail
        ? { status: 503, body: { error: "Consulta no disponible" } }
        : ok({ profiles: [] });
    if (url === "/api/v1/products" && init.method === "GET")
      return failRead
        ? { status: 503, body: { error: "Consulta no disponible" } }
        : ok({ products: structuredClone(products) });
    if (
      (url === "/api/v1/products" && init.method === "POST") ||
      (/^\/api\/v1\/products\/[^/]+$/.test(url) && init.method === "PATCH")
    ) {
      if (holdSave) await holdSave;
      if (saveFail)
        return {
          status: 409,
          body: { error: "El SKU ya está registrado en esta empresa." },
        };
      const data = JSON.parse(init.body);
      let p;
      if (init.method === "PATCH") {
        p = products.find((p) => url.endsWith(p.id));
        Object.assign(p, data);
        if (data.barcode === null) delete p.barcode;
      } else {
        p = { ...data, id: uid(99) };
        products.push(p);
      }
      return ok({ product: structuredClone(p) });
    }
    return { status: 404, body: { error: "Unmocked request" } };
  });
  await page.goto(address);
  await page.getByRole("heading", { name: "Productos", exact: true }).waitFor();
  await page
    .getByText("Cargando productos…", { exact: true })
    .waitFor({ state: "hidden" });
  return {
    context,
    page,
    calls,
    errors,
    products,
    recover() {
      failRead = false;
    },
    taxRecover() {
      taxFail = false;
    },
    saveFail(v = true) {
      saveFail = v;
    },
    hold() {
      holdSave = new Promise((r) => (releaseSave = r));
    },
    release() {
      releaseSave?.();
      holdSave = null;
    },
    async close() {
      assert.deepEqual(errors, []);
      await context.close();
    },
  };
}
async function openNew(p) {
  await p.getByRole("button", { name: "Nuevo producto", exact: true }).click();
  await p.locator('input[name="name"]').waitFor();
  await p.waitForFunction(
    () => !document.querySelector('input[name="name"]').disabled,
  );
}
const field = (p, n) => p.locator(`[name="${n}"]`);
try {
  let s = await session(),
    p = s.page;
  assert.equal(await p.getByRole("rowheader").count(), 3);
  pass("catalog-name-sku-barcode-price-state");
  await p.getByRole("searchbox").fill("CAFE centro");
  assert.equal(await p.getByRole("rowheader").count(), 1);
  assert.equal(s.calls.filter((c) => c.url === "/api/v1/products").length, 1);
  pass("accent-insensitive-multiple-terms-no-extra-fetch");
  await p.getByRole("button", { name: "Limpiar filtros", exact: true }).click();
  await p.locator(".catalog-toolbar select").nth(1).selectOption("kg");
  assert.equal(await p.getByRole("rowheader").count(), 1);
  await p.locator(".catalog-toolbar select").nth(0).selectOption("inactive");
  await p
    .getByRole("heading", { name: "No encontramos productos", exact: true })
    .waitFor();
  pass("combined-unit-state-no-match");
  await p
    .getByRole("button", { name: "Limpiar búsqueda", exact: true })
    .click();
  assert.equal(await p.getByRole("rowheader").count(), 3);
  await p.getByRole("searchbox").fill("7500000000002");
  assert.equal(await p.getByRole("rowheader").count(), 1);
  pass("clear-all-filters-and-barcode-search");
  await s.close();
  for (const [name, width] of [
    ["desktop", 1440],
    ["tablet", 1024],
    ["small-tablet", 768],
    ["mobile", 390],
    ["small-mobile", 320],
  ]) {
    s = await session({ width });
    p = s.page;
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.equal(
      await p
        .getByRole("columnheader", { name: "Producto", exact: true })
        .count(),
      1,
    );
    assert.ok((await p.locator("main").innerText()).includes("piezas"));
    await p.screenshot({
      path: path.join(process.argv[2], `products-${name}.png`),
      fullPage: true,
    });
    const editSize = await p
      .getByRole("button", {
        name: "Editar Café molido del Centro",
        exact: true,
      })
      .first()
      .boundingBox();
    assert.ok(editSize.width >= 70, "Edit action must fit a readable label");
    const summarySize = await p
      .locator(".product-more summary")
      .first()
      .evaluate((n) => Number.parseFloat(getComputedStyle(n).fontSize));
    assert.ok(
      summarySize <= 16,
      "Secondary action must not dominate the catalogue",
    );
    pass(`catalog-responsive-${name}`);
    await openNew(p);
    await field(p, "name").fill("Producto ficticio");
    await p.screenshot({
      path: path.join(process.argv[2], `product-form-${name}.png`),
      fullPage: true,
    });
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const small = await p
      .locator("main button,main input,main select")
      .evaluateAll((nodes) =>
        nodes
          .filter((n) => {
            const r = n.getBoundingClientRect();
            return r.height > 0 && r.height < 43;
          })
          .map((n) => n.textContent),
      );
    assert.deepEqual(small, []);
    pass(`form-responsive-${name}`);
    await s.close();
  }
  s = await session();
  p = s.page;
  await openNew(p);
  await field(p, "name").fill("Producto nuevo");
  await field(p, "sku").fill("sku incorrecto");
  await p
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await p.getByRole("alert").filter({ hasText: "Revisa los campos" }).waitFor();
  assert.equal(await field(p, "sku").getAttribute("aria-invalid"), "true");
  assert.equal(s.calls.filter((c) => c.method === "POST").length, 0);
  pass("invalid-sku-explained-no-request");
  await field(p, "sku").fill("SKU.01");
  await field(p, "salePrice").fill("1,50");
  await p
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await p.getByRole("alert").filter({ hasText: "Usa un importe" }).waitFor();
  assert.equal(await field(p, "name").inputValue(), "Producto nuevo");
  pass("invalid-price-preserves-form");
  await field(p, "salePrice").fill("123.45");
  await field(p, "purchaseCost").fill("25.50");
  await field(p, "barcode").fill("ABC123");
  await p
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await p.getByText("Producto guardado.", { exact: true }).waitFor();
  const cmd = JSON.parse(s.calls.find((c) => c.method === "POST").body);
  assert.equal(cmd.salePrice.minorUnits, "12345");
  assert.equal(cmd.purchaseCost.minorUnits, "2550");
  assert.equal(cmd.sku, "SKU.01");
  assert.equal(cmd.barcode, "ABC123");
  pass("create-keeps-exact-money-and-sku-contract");
  await s.close();
  s = await session();
  p = s.page;
  await p
    .getByRole("button", { name: "Editar Café molido del Centro", exact: true })
    .first()
    .click();
  await p.waitForFunction(
    () => !document.querySelector('input[name="name"]').disabled,
  );
  await field(p, "salePrice").fill("40.25");
  await p
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await p.getByText("Producto guardado.", { exact: true }).waitFor();
  const edit = JSON.parse(s.calls.find((c) => c.method === "PATCH").body);
  assert.deepEqual(edit, { salePrice: money(4025) });
  pass("edit-only-changed-price-no-stock-or-other-fields");
  await s.close();
  s = await session();
  p = s.page;
  await openNew(p);
  await field(p, "name").fill("Conservar borrador");
  assert.equal(
    await p
      .getByRole("button", { name: "Cerrar sesión", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await p
      .getByRole("button", { name: "Actualizar", exact: true })
      .isDisabled(),
    true,
  );
  await p
    .getByText("Navegación bloqueada durante edición", { exact: true })
    .waitFor();
  p.once("dialog", (d) => d.dismiss());
  await p.getByRole("button", { name: "Cancelar", exact: true }).click();
  assert.equal(await field(p, "name").inputValue(), "Conservar borrador");
  assert.equal(
    await p.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    }),
    true,
  );
  pass("cancel-dismiss-navigation-guard-and-beforeunload");
  p.once("dialog", (d) => d.accept());
  await p.getByRole("button", { name: "Cancelar", exact: true }).click();
  assert.equal(await field(p, "name").count(), 0);
  pass("cancel-confirm-discards-only-editor");
  await s.close();
  s = await session();
  p = s.page;
  await openNew(p);
  await field(p, "name").fill("Producto retenido");
  await field(p, "sku").fill("DUPLICADO");
  s.saveFail();
  await p
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await p
    .getByRole("alert")
    .filter({ hasText: "SKU ya está registrado" })
    .waitFor();
  assert.equal(await field(p, "name").inputValue(), "Producto retenido");
  assert.equal(await field(p, "sku").inputValue(), "DUPLICADO");
  pass("server-rejection-preserves-unsaved-values");
  s.saveFail(false);
  await field(p, "sku").fill("OTRO-SKU");
  await p
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await p.getByText("Producto guardado.", { exact: true }).waitFor();
  pass("explicit-retry-after-server-error");
  await s.close();
  s = await session({ mode: "tax-error" });
  p = s.page;
  await p.getByRole("button", { name: "Nuevo producto", exact: true }).click();
  await p
    .getByRole("button", { name: "Reintentar impuestos", exact: true })
    .waitFor();
  assert.equal(
    await p
      .getByRole("button", { name: "Guardar producto", exact: true })
      .isDisabled(),
    true,
  );
  s.taxRecover();
  await p
    .getByRole("button", { name: "Reintentar impuestos", exact: true })
    .click();
  await p.waitForFunction(
    () => !document.querySelector('input[name="name"]').disabled,
  );
  pass("tax-read-failure-and-local-retry-no-page-reload");
  await s.close();
  s = await session({ mode: "read-error" });
  p = s.page;
  await p
    .getByRole("heading", {
      name: "No pudimos consultar el catálogo",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await p
      .getByRole("heading", { name: "Aún no tienes productos", exact: true })
      .count(),
    0,
  );
  s.recover();
  await p.getByRole("button", { name: "Actualizar", exact: true }).click();
  await p.getByRole("rowheader").first().waitFor();
  pass("catalog-error-not-empty-and-explicit-recovery");
  await s.close();
  s = await session({ mode: "empty" });
  await s.page
    .getByRole("heading", { name: "Aún no tienes productos", exact: true })
    .waitFor();
  pass("genuine-empty-catalogue");
  await s.close();
  s = await session({ canWrite: false, width: 390 });
  p = s.page;
  assert.equal(
    await p
      .getByRole("button", { name: "Nuevo producto", exact: true })
      .count(),
    0,
  );
  assert.equal(await p.getByRole("button", { name: /^Editar / }).count(), 0);
  pass("read-only-no-create-or-edit");
  await s.close();
  assert.equal(externalRequests, 0);
  pass("zero-external-service-requests");
  console.log(JSON.stringify({ checks, externalRequests }));
} finally {
  await browser.close();
}
