// Real POS, domain quantities, quote UI and dialog. All services are synthetic.
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
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
  fixture = path.join(root, "scripts/pos-ux-01");
const result = await build({
  configFile: false,
  envDir: false,
  root,
  logLevel: "silent",
  resolve: {
    alias: [
      ...[
        "next/link",
        "next/navigation",
        "next/dynamic",
        "../components/smart-scanner",
        "../components/app-navigation",
        "../components/ui",
        "../components/business-context",
        "../components/pos-customer-selector",
        "../components/pos-credit",
        "../components/product-thumbnails",
      ].map((find) => ({ find, replacement: path.join(fixture, "shims.tsx") })),
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
      name: "PosFixture",
      formats: ["iife"],
    },
  },
});
const out = (Array.isArray(result) ? result[0] : result).output,
  chunk = out.find((x) => x.type === "chunk"),
  css = out
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
const tenant = "550e8400-e29b-41d4-a716-446655440001",
  location = "550e8400-e29b-41d4-a716-446655440011",
  user = "550e8400-e29b-41d4-a716-446655440020",
  shift = "550e8400-e29b-41d4-a716-446655440030";
const id = (n) => `550e8400-e29b-41d4-a716-${n.toString().padStart(12, "0")}`;
const coffee = "Café orgánico 250 g",
  rice = "Arroz a granel";
const products = [
  {
    id: id(100),
    name: coffee,
    sku: "CAFE-250",
    barcode: "7501234567890",
    unit: "piece",
    purchaseCost: { currency: "MXN", minorUnits: "1000" },
    salePrice: { currency: "MXN", minorUnits: "2500" },
    status: "active",
  },
  {
    id: id(101),
    name: rice,
    sku: "ARR-GRANEL",
    barcode: "7501234567891",
    unit: "kg",
    purchaseCost: { currency: "MXN", minorUnits: "2000" },
    salePrice: { currency: "MXN", minorUnits: "4000" },
    status: "active",
  },
  {
    id: id(102),
    name: "Agua natural 1 litro",
    sku: "AGUA-1L",
    unit: "piece",
    purchaseCost: { currency: "MXN", minorUnits: "1000" },
    salePrice: { currency: "MXN", minorUnits: "1500" },
    status: "active",
  },
  {
    id: id(103),
    name: "Producto con un nombre largo para comprobar la lectura y selección en pantallas pequeñas",
    sku: "NOMBRE-LARGO-12345678901234567890",
    unit: "piece",
    purchaseCost: { currency: "MXN", minorUnits: "1000" },
    salePrice: { currency: "MXN", minorUnits: "12500" },
    status: "active",
  },
  {
    id: id(104),
    name: "Inactivo",
    sku: "INACTIVO",
    unit: "piece",
    purchaseCost: { currency: "MXN", minorUnits: "0" },
    salePrice: { currency: "MXN", minorUnits: "0" },
    status: "inactive",
  },
];
const browser = await chromium.launch({ headless: true });
let externalRequests = 0,
  checks = 0;
const pass = (name) => {
  checks++;
  console.log(JSON.stringify({ name, result: "PASS" }));
};
async function session(width, mode = "normal", height = 960) {
  const context = await browser.newContext({
    viewport: { width, height },
    serviceWorkers: "block",
  });
  await context.route("**/*", (r) => {
    if (r.request().url() === "http://127.0.0.1:55993/")
      return r.fulfill({ contentType: "text/html", body: html });
    externalRequests++;
    return r.abort();
  });
  const calls = [],
    sales = new Map();
  let catalogFailed = false,
    uncertain = false,
    hold = null,
    release = null;
  await context.exposeFunction("posMock", async (url, init) => {
    calls.push({ url, ...init });
    if (url === "/api/v1/tenants")
      return {
        status: 200,
        body: {
          tenants: [
            {
              tenantId: tenant,
              tenantName: "Empresa ficticia",
              displayName: "Cajero ficticio",
              permissions: ["sales.create", "sales.read", "inventory.read"],
            },
          ],
        },
      };
    assert.equal(init.headers["x-tenant-id"], tenant);
    if (url === "/api/v1/products") {
      if (mode === "catalog-error" && !catalogFailed) {
        catalogFailed = true;
        return {
          status: 503,
          body: { error: "Catálogo temporalmente no disponible." },
        };
      }
      return { status: 200, body: { products } };
    }
    if (url === "/api/v1/locations")
      return {
        status: 200,
        body: {
          locations: [
            {
              id: location,
              code: "CENTRO",
              name: "Sucursal Centro",
              status: "active",
            },
          ],
        },
      };
    if (url.startsWith("/api/v1/inventory?"))
      return {
        status: 200,
        body: {
          stock: products
            .filter((p) => p.status === "active")
            .map((p) => ({
              productId: p.id,
              locationId: location,
              quantity: {
                unit: p.unit,
                milliUnits: p.id === id(102) ? "0" : "25000",
              },
            })),
        },
      };
    if (url.startsWith("/api/v1/cash?"))
      return {
        status: 200,
        body: {
          shift: mode === "closed" ? null : { id: shift, status: "open" },
        },
      };
    if (url === "/api/v1/sales/quote") {
      const input = JSON.parse(init.body);
      if (mode === "quote-error")
        return {
          status: 503,
          body: { error: "No pudimos cotizar esta venta." },
        };
      return {
        status: 200,
        body: { sale: { ...input.draft, status: "completed" }, taxes: [] },
      };
    }
    if (url === "/api/v1/sales" && init.method === "POST") {
      const input = JSON.parse(init.body);
      const previous = sales.get(input.draft.id);
      if (previous) assert.deepEqual(input, previous.command);
      else sales.set(input.draft.id, { command: input });
      if (mode === "uncertain" && !uncertain) {
        uncertain = true;
        return {
          status: 500,
          body: { error: "Resultado incierto. Reintenta la misma venta." },
        };
      }
      if (hold) await hold;
      return {
        status: 200,
        body: {
          recorded: {
            tenantId: tenant,
            locationId: location,
            createdBy: user,
            createdAt: "2026-10-24T12:00:00.000Z",
            shiftId: shift,
            sale: { ...input.draft, status: "completed" },
            payments: input.payments,
          },
          replayed: !!previous,
        },
      };
    }
    throw new Error("UNEXPECTED_SYNTHETIC_REQUEST " + url);
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:55993/");
  if (mode === "catalog-error") {
    await page.getByRole("button", { name: "Reintentar catálogo" }).click();
    pass("catalog-error-explicit-retry");
  }
  await page.getByRole("searchbox", { name: "Buscar productos" }).waitFor();
  await page.locator(".pos-product").first().waitFor();
  return {
    context,
    page,
    calls,
    sales,
    errors,
    holdCheckout() {
      hold = new Promise((resolve) => {
        release = resolve;
      });
    },
    releaseCheckout() {
      release?.();
    },
    async cart() {
      if (
        width <= 760 &&
        !(await page.locator(".pilot-sale-panel").evaluate((el) => el.open))
      )
        await page.getByRole("button", { name: /Ver carrito:/ }).click();
    },
    close: () => context.close(),
  };
}
const ready = (page) =>
  page.waitForFunction(() => {
    const b = document.querySelector(".pos-checkout");
    return b && !b.disabled;
  });
const quantity = (page, name) =>
  page.getByRole("textbox", { name: `Cantidad de ${name}`, exact: true });
try {
  const s = await session(1440),
    p = s.page;
  assert.equal(await p.locator(".pos-product").count(), 4);
  pass("active-products-and-empty-cart");
  assert.equal(await p.locator(".pos-checkout").isDisabled(), true);
  await p.getByRole("searchbox").fill("cafe");
  assert.equal(await p.locator(".pos-product").count(), 1);
  pass("accent-insensitive-name-search");
  await p.getByRole("searchbox").fill("CAFE-250");
  assert.equal(await p.locator(".pos-product").count(), 1);
  pass("sku-search");
  await p.getByRole("searchbox").fill("7501234567890");
  await p.getByRole("searchbox").press("Enter");
  await ready(p);
  await quantity(p, coffee).waitFor();
  pass("barcode-search-and-enter-add");
  await p
    .getByRole("button", { name: `Aumentar cantidad de ${coffee}` })
    .click();
  await p.waitForFunction(
    () => document.querySelector(".pos-quantity input")?.value === "2",
  );
  await ready(p);
  assert.ok(
    (await p.locator(".sale-checkout-total").innerText()).includes("$50.00"),
  );
  pass("increase-quantity-and-total");
  await quantity(p, coffee).fill("0");
  await quantity(p, coffee).blur();
  await p
    .getByRole("button", { name: `Aumentar cantidad de ${coffee}` })
    .click();
  assert.equal(await quantity(p, coffee).inputValue(), "0");
  assert.ok(
    (await p.locator(".sale-checkout-total").innerText()).includes("$50.00"),
  );
  assert.equal(s.sales.size, 0);
  await quantity(p, coffee).fill("2");
  await quantity(p, coffee).blur();
  await ready(p);
  pass("nonpositive-entry-is-not-stepped");
  await p
    .getByRole("button", { name: `Disminuir cantidad de ${coffee}` })
    .click();
  await ready(p);
  assert.equal(await quantity(p, coffee).inputValue(), "1");
  assert.equal(
    await p
      .getByRole("button", { name: `Disminuir cantidad de ${coffee}` })
      .isDisabled(),
    true,
  );
  pass("decrease-without-accidental-removal");
  await quantity(p, coffee).fill("incorrecto");
  await quantity(p, coffee).blur();
  await p.getByRole("alert").first().waitFor();
  assert.equal(s.sales.size, 0);
  await quantity(p, coffee).fill("1");
  await quantity(p, coffee).blur();
  await ready(p);
  pass("invalid-quantity-does-not-submit");
  await p.getByRole("button", { name: "Limpiar", exact: true }).click();
  await p.getByRole("button", { name: `Agregar ${rice}`, exact: true }).click();
  await ready(p);
  await quantity(p, rice).fill("0.250");
  await quantity(p, rice).blur();
  await ready(p);
  assert.ok(
    (await p.locator(".sale-checkout-total").innerText()).includes("$35.00"),
  );
  pass("fractional-quantity-existing-calculation");
  await p
    .getByRole("button", { name: `Eliminar ${rice}`, exact: true })
    .click();
  await ready(p);
  assert.equal(await p.locator(".pos-line").count(), 1);
  pass("remove-only-selected-product");
  await p.getByRole("searchbox").fill("No existe");
  await p
    .getByText("No encontramos productos con esa búsqueda.", { exact: false })
    .waitFor();
  await p.getByRole("button", { name: "Ver todos los productos" }).click();
  pass("no-results-and-clear");
  await p.getByText("Sin existencias", { exact: true }).waitFor();
  assert.ok(
    (await p.locator(".pos-product").first().innerText()).includes(
      "Disponible:",
    ),
  );
  pass("price-stock-and-unit-labels");
  if (process.argv[2])
    await p.screenshot({
      path: path.join(process.argv[2], "pos-desktop.png"),
      fullPage: false,
    });
  s.holdCheckout();
  await p.locator(".pos-checkout").evaluate((button) => {
    button.click();
    button.click();
  });
  await p.waitForFunction(() =>
    document
      .querySelector(".pos-checkout")
      ?.textContent.includes("Confirmando"),
  );
  assert.equal(
    s.calls.filter((c) => c.url === "/api/v1/sales" && c.method === "POST")
      .length,
    1,
  );
  assert.equal(
    await p
      .getByRole("button", { name: `Aumentar cantidad de ${coffee}` })
      .isDisabled(),
    true,
  );
  pass("single-submit-and-locked-processing");
  s.releaseCheckout();
  await p
    .getByRole("heading", { name: "Venta confirmada", exact: true })
    .waitFor();
  assert.equal(s.sales.size, 1);
  const command = [...s.sales.values()][0].command;
  assert.equal(command.payments[0].method, "cash");
  assert.equal(command.payments[0].amount.minorUnits, "2500");
  pass("cash-checkout-existing-contract");
  assert.deepEqual(s.errors, []);
  await s.close();
  for (const [width, label, height] of [
    [1024, "tablet", 768],
    [820, "tablet-landscape", 600],
    [390, "mobile", 844],
    [320, "small-mobile", 740],
  ]) {
    const s = await session(width, "normal", height),
      p = s.page;
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await p
      .getByRole("button", { name: `Agregar ${coffee}`, exact: true })
      .click();
    await s.cart();
    await ready(p);
    await p
      .getByRole("button", { name: `Aumentar cantidad de ${coffee}` })
      .click();
    await ready(p);
    assert.equal(await quantity(p, coffee).inputValue(), "2");
    const box = await p
      .getByRole("button", { name: `Aumentar cantidad de ${coffee}` })
      .boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44);
    assert.ok(
      await p
        .locator(".pilot-sale-panel")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    const payBox = await p.locator(".pos-checkout").boundingBox();
    assert.ok(
      payBox.x >= 0 &&
        payBox.x + payBox.width <= width + 1 &&
        payBox.y >= 0 &&
        payBox.y + payBox.height <= height,
    );
    if (process.argv[2])
      await p.screenshot({
        path: path.join(process.argv[2], `pos-${label}.png`),
        fullPage: false,
      });
    if (width <= 760) {
      await p.getByRole("button", { name: "Cerrar venta actual" }).click();
      await p.getByRole("button", { name: /Ver carrito:/ }).waitFor();
      await s.cart();
      await ready(p);
    }
    pass("responsive-and-cart-access-" + width);
    assert.deepEqual(s.errors, []);
    await s.close();
  }
  for (const method of ["card", "mixed"]) {
    const s = await session(1440),
      p = s.page;
    await p
      .getByRole("button", { name: `Agregar ${coffee}`, exact: true })
      .click();
    await ready(p);
    await p
      .locator("select")
      .filter({ has: p.locator('option[value="mixed"]') })
      .selectOption(method);
    if (method === "mixed")
      await p
        .getByRole("textbox", { name: "Efectivo (MXN)", exact: true })
        .fill("10.00");
    await p.locator(".pos-checkout").click();
    await p
      .getByRole("heading", { name: "Venta confirmada", exact: true })
      .waitFor();
    const payments = [...s.sales.values()][0].command.payments;
    assert.deepEqual(
      payments.map((v) => [v.method, v.amount.minorUnits]),
      method === "card"
        ? [["card", "2500"]]
        : [
            ["cash", "1000"],
            ["card", "1500"],
          ],
    );
    pass("unchanged-payment-" + method);
    await s.close();
  }
  const pending = await session(1440, "uncertain");
  await pending.page
    .getByRole("button", { name: `Agregar ${coffee}`, exact: true })
    .click();
  await ready(pending.page);
  await pending.page.locator(".pos-checkout").click();
  await pending.page
    .getByRole("button", { name: "Reintentar la misma venta", exact: true })
    .waitFor();
  assert.equal(await quantity(pending.page, coffee).isDisabled(), true);
  await pending.page.reload();
  await pending.page
    .getByRole("button", { name: "Reintentar la misma venta", exact: true })
    .click();
  await pending.page
    .getByRole("heading", { name: "Venta confirmada", exact: true })
    .waitFor();
  assert.equal(pending.sales.size, 1);
  const attempts = pending.calls.filter(
    (c) => c.url === "/api/v1/sales" && c.method === "POST",
  );
  assert.equal(attempts.length, 2);
  assert.deepEqual(JSON.parse(attempts[0].body), JSON.parse(attempts[1].body));
  pass("uncertain-response-reload-identical-retry");
  await pending.close();
  for (const mode of ["closed", "quote-error"]) {
    const s = await session(1440, mode);
    await s.page
      .getByRole("button", { name: `Agregar ${coffee}`, exact: true })
      .click();
    await s.page.locator(".pos-line").waitFor();
    if (mode === "quote-error")
      await s.page
        .getByText("No pudimos cotizar esta venta.", { exact: true })
        .waitFor();
    assert.equal(await s.page.locator(".pos-checkout").isDisabled(), true);
    assert.equal(s.sales.size, 0);
    pass("checkout-disabled-" + mode);
    await s.close();
  }
  const retry = await session(1440, "catalog-error");
  await retry.close();
  assert.equal(externalRequests, 0);
  pass("zero-external-service-requests");
  console.log(JSON.stringify({ checks, externalRequests }));
} finally {
  await browser.close();
}
