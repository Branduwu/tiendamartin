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
  fixture = path.join(root, "scripts/operacion-01");
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
      if (mode === "rejected-storage")
        return {
          status: 409,
          body: {
            error: "Stock insuficiente. Revisa las cantidades del carrito.",
          },
        };
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
  if (process.argv[3] !== "reproduce") {
    for (const [method, width] of [
      ["cash", 1440],
      ["card", 390],
      ["mixed", 320],
    ]) {
      const s = await session(width),
        p = s.page;
      await p
        .getByRole("button", { name: `Agregar ${coffee}`, exact: true })
        .click();
      await s.cart();
      await ready(p);
      await p
        .locator("select")
        .filter({ has: p.locator('option[value="mixed"]') })
        .selectOption(method);
      if (method === "mixed")
        await p
          .getByRole("textbox", { name: "Efectivo (MXN)", exact: true })
          .fill("10.00");
      s.holdCheckout();
      await p.locator(".pos-checkout").dblclick();
      assert.equal(
        s.calls.filter((c) => c.url === "/api/v1/sales" && c.method === "POST")
          .length,
        1,
      );
      assert.equal(await quantity(p, coffee).isDisabled(), true);
      pass(`single-submit-locked-${method}`);
      s.releaseCheckout();
      await p
        .getByRole("heading", { name: "Venta confirmada", exact: true })
        .waitFor();
      const command = [...s.sales.values()][0].command;
      assert.equal(command.draft.total.minorUnits, "2500");
      assert.equal(
        command.payments.reduce((n, x) => n + BigInt(x.amount.minorUnits), 0n),
        2500n,
      );
      assert.equal(
        await p
          .getByRole("link", { name: "Ver ticket", exact: true })
          .getAttribute("href"),
        `/sales/${command.draft.id}?tenantId=${tenant}`,
      );
      assert.equal(await p.locator(".pos-checkout").isDisabled(), true);
      pass(`sale-confirmation-correct-ticket-and-total-${method}`);
      assert.deepEqual(s.errors, []);
      await s.close();
    }
    const uncertain = await session(1440, "uncertain"),
      p = uncertain.page;
    await p
      .getByRole("button", { name: `Agregar ${coffee}`, exact: true })
      .click();
    await ready(p);
    await p.locator(".pos-checkout").click();
    await p
      .getByRole("button", { name: "Reintentar la misma venta", exact: true })
      .waitFor();
    await p.reload();
    await p
      .getByRole("button", { name: "Reintentar la misma venta", exact: true })
      .click();
    await p
      .getByRole("heading", { name: "Venta confirmada", exact: true })
      .waitFor();
    const attempts = uncertain.calls.filter(
      (c) => c.url === "/api/v1/sales" && c.method === "POST",
    );
    assert.equal(attempts.length, 2);
    assert.deepEqual(
      JSON.parse(attempts[0].body),
      JSON.parse(attempts[1].body),
    );
    assert.equal(uncertain.sales.size, 1);
    assert.deepEqual(uncertain.errors, []);
    pass("uncertain-response-reload-identical-command-and-ticket");
    await uncertain.close();
    for (const mode of ["closed", "quote-error"]) {
      const s = await session(1440, mode),
        p = s.page;
      await p
        .getByRole("button", { name: `Agregar ${coffee}`, exact: true })
        .click();
      await p.locator(".pos-line").waitFor();
      if (mode === "quote-error")
        await p
          .getByText("No pudimos cotizar esta venta.", { exact: true })
          .waitFor();
      assert.equal(await p.locator(".pos-checkout").isDisabled(), true);
      assert.equal(s.sales.size, 0);
      pass(`no-sale-when-${mode}`);
      await s.close();
    }
  }
  const s = await session(1440, "rejected-storage"),
    p = s.page;
  await p
    .getByRole("button", { name: `Agregar ${coffee}`, exact: true })
    .click();
  await ready(p);
  await p.evaluate(() => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      if (key.startsWith("smartretail.pending-sale."))
        throw new DOMException(
          "Synthetic storage removal denied",
          "SecurityError",
        );
      return original.call(this, key);
    };
  });
  await p.locator(".pos-checkout").click();
  await p.waitForFunction(
    () =>
      !document
        .querySelector(".pos-checkout")
        ?.textContent.includes("Confirmando"),
  );
  assert.equal(
    s.calls.filter((c) => c.url === "/api/v1/sales" && c.method === "POST")
      .length,
    1,
  );
  assert.equal(s.sales.size, 0);
  const retained = await p.evaluate(() =>
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith("smartretail.pending-sale."))
      .map((k) => sessionStorage.getItem(k)),
  );
  assert.equal(retained.length, 1);
  if (process.argv[3] === "reproduce") {
    assert.ok(
      s.errors.some((e) => e.includes("Synthetic storage removal denied")),
    );
    assert.equal(await p.locator(".pos-checkout").isDisabled(), false);
    console.log(
      JSON.stringify({
        risk: "REPRODUCED",
        unhandledStorageError: true,
        checkoutEnabledAfterStorageFailure: true,
        commandRetained: true,
        productionOperations: 0,
      }),
    );
  } else {
    assert.deepEqual(s.errors, []);
    await p
      .getByRole("alert")
      .filter({ hasText: "No pudimos retirar el intento rechazado" })
      .waitFor();
    assert.equal(await p.locator(".pos-checkout").isDisabled(), true);
    assert.equal(
      JSON.parse(retained[0]).command.draft.id,
      JSON.parse(s.calls.find((c) => c.url === "/api/v1/sales").body).draft.id,
    );
    pass("storage-removal-failure-preserves-command-and-blocks-new-checkout");
    await p.reload();
    await p
      .getByRole("button", { name: "Reintentar la misma venta", exact: true })
      .waitFor();
    await p
      .getByRole("button", { name: "Reintentar la misma venta", exact: true })
      .click();
    await p
      .getByRole("alert")
      .filter({ hasText: "Stock insuficiente." })
      .waitFor();
    const retried = s.calls.filter(
      (c) => c.url === "/api/v1/sales" && c.method === "POST",
    );
    assert.equal(retried.length, 2);
    assert.deepEqual(JSON.parse(retried[0].body), JSON.parse(retried[1].body));
    assert.equal(s.sales.size, 0);
    assert.deepEqual(s.errors, []);
    assert.equal(
      await p.evaluate(
        () =>
          Object.keys(sessionStorage).filter((k) =>
            k.startsWith("smartretail.pending-sale."),
          ).length,
      ),
      0,
    );
    pass("storage-recovery-reload-same-command-and-clean-rejection");
  }
  await s.close();
  assert.equal(externalRequests, 0);
  pass("zero-external-service-requests");
  console.log(JSON.stringify({ checks, externalRequests }));
} finally {
  await browser.close();
}
