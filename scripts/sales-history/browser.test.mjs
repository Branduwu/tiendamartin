// Real React + Chromium; all HTTP is synthetic and external requests are blocked.
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
  fixture = path.join(root, "scripts/sales-history");
const result = await build({
  configFile: false,
  envDir: false,
  root,
  logLevel: "silent",
  resolve: {
    alias: [
      ...["next/link", "../components/app-navigation"].map((find) => ({
        find,
        replacement: path.join(fixture, "shims.tsx"),
      })),
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
      name: "SalesFixture",
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
const html = `<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${chunk.code.replaceAll("</script", "<\\/script")}</script></body></html>`;
const tenant = "550e8400-e29b-41d4-a716-446655440001",
  otherTenant = "550e8400-e29b-41d4-a716-446655440002",
  location = "550e8400-e29b-41d4-a716-446655440011",
  otherLocation = "550e8400-e29b-41d4-a716-446655440012";
const id = (n) => `550e8400-e29b-41d4-a716-${n.toString().padStart(12, "0")}`;
const dataset = Array.from({ length: 53 }, (_, i) => ({
  tenantId: tenant,
  locationId: i % 2 ? location : otherLocation,
  locationName: i % 2 ? "Sucursal Centro" : "Sucursal Norte",
  createdBy: id(999),
  createdByName: "María López",
  createdAt: "2026-10-23T12:00:00.123Z",
  shiftId: null,
  customerName: i === 52 ? "Cliente antiguo" : "Cliente de mostrador",
  sale: {
    id: id(100 - i),
    status: "completed",
    total: { currency: "MXN", minorUnits: "100" },
    lines: [
      {
        productId: id(500),
        sku: "CAFE",
        name: "Café",
        unit: "piece",
        quantity: { unit: "piece", milliUnits: "1000" },
        unitPrice: { currency: "MXN", minorUnits: "100" },
        lineTotal: { currency: "MXN", minorUnits: "100" },
      },
    ],
  },
  payments: [
    {
      method: i % 2 ? "cash" : "card",
      amount: { currency: "MXN", minorUnits: "100" },
    },
  ],
}));
const browser = await chromium.launch({ headless: true });
let externalRequests = 0,
  checks = 0;
const pass = (name) => {
  checks++;
  console.log(JSON.stringify({ name, result: "PASS" }));
};
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  await context.route("**/*", (r) => {
    if (r.request().url() === "http://127.0.0.1:55992/")
      return r.fulfill({ contentType: "text/html", body: html });
    externalRequests++;
    return r.abort();
  });
  const requests = [];
  let fail = false,
    delay = false,
    release = null;
  await context.exposeFunction("salesMock", async (url, headers) => {
    if (url === "/api/v1/tenants")
      return {
        status: 200,
        body: {
          tenants: [
            { tenantId: tenant, permissions: ["sales.read"] },
            { tenantId: otherTenant, permissions: ["sales.read"] },
          ],
        },
      };
    if (url === "/api/v1/locations")
      return {
        status: 200,
        body: {
          locations: [
            { id: location, name: "Sucursal Centro" },
            { id: otherLocation, name: "Sucursal Norte" },
          ],
        },
      };
    const u = new URL(url, "http://127.0.0.1:55992");
    assert.equal(u.pathname, "/api/v1/sales");
    assert.ok([tenant, otherTenant].includes(headers["x-tenant-id"]));
    requests.push({ url, tenant: headers["x-tenant-id"] });
    if (delay) {
      delay = false;
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    if (fail) {
      fail = false;
      return {
        status: 503,
        body: { error: "Consulta temporalmente no disponible." },
      };
    }
    const q = u.searchParams;
    let rows = dataset;
    if (headers["x-tenant-id"] === otherTenant) rows = [];
    if (q.get("q"))
      rows = rows.filter((s) =>
        (s.customerName + " Café CAFE " + s.sale.id)
          .toLowerCase()
          .includes(q.get("q").toLowerCase()),
      );
    if (q.get("locationId"))
      rows = rows.filter((s) => s.locationId === q.get("locationId"));
    if (q.get("payment"))
      rows = rows.filter((s) =>
        s.payments.some((p) => p.method === q.get("payment")),
      );
    if (q.get("cursor"))
      rows = rows.filter((s) => s.sale.id < q.get("cursor").split("~")[1]);
    const page = rows.slice(0, 50),
      last = page.at(-1);
    return {
      status: 200,
      body: {
        sales: page,
        returnedSaleIds: [],
        nextCursor:
          rows.length > 50
            ? `2026-10-23T12:00:00.123000Z~${last.sale.id}`
            : null,
      },
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const rows = (n) =>
    page.waitForFunction(
      (count) => document.querySelectorAll("tbody tr").length === count,
      n,
    );
  await page.goto("http://127.0.0.1:55992/");
  await rows(50);
  assert.equal(requests.length, 1);
  pass("first-page-50");
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await rows(3);
  assert.ok(requests.at(-1).url.includes("cursor="));
  assert.equal(
    await page
      .getByRole("button", { name: "Siguiente", exact: true })
      .isDisabled(),
    true,
  );
  pass("older-sales-keyset");
  await page.reload();
  await rows(3);
  assert.equal(
    await page
      .getByRole("button", { name: "Anterior", exact: true })
      .isDisabled(),
    false,
  );
  pass("return-context-retains-page");
  await page.getByRole("button", { name: "Anterior", exact: true }).click();
  await rows(50);
  pass("previous-page");
  await page.getByRole("searchbox").fill("Cliente antiguo");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await rows(1);
  assert.equal(
    await page
      .getByRole("button", { name: "Anterior", exact: true })
      .isDisabled(),
    true,
  );
  pass("search-entire-history-reset-page");
  await page.reload();
  await rows(1);
  assert.equal(
    await page.getByRole("searchbox").inputValue(),
    "Cliente antiguo",
  );
  pass("return-context-retains-filters");
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await rows(50);
  await page.getByLabel("Forma de pago", { exact: true }).selectOption("cash");
  await page.getByLabel("Ubicación", { exact: true }).selectOption(location);
  await page.getByLabel("Desde", { exact: true }).fill("2026-10-01");
  await page.getByLabel("Hasta", { exact: true }).fill("2026-10-23");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await rows(26);
  const filtered = new URL(requests.at(-1).url, "http://127.0.0.1");
  assert.equal(filtered.searchParams.get("payment"), "cash");
  assert.equal(filtered.searchParams.get("locationId"), location);
  assert.equal(filtered.searchParams.get("from"), "2026-10-01");
  assert.equal(filtered.searchParams.get("to"), "2026-10-23");
  pass("combined-server-filters");
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await rows(50);
  pass("clear-filters");
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.ok(
      await page
        .locator("tbody time")
        .first()
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    const bounds = await page.locator("tbody a").first().boundingBox();
    assert.ok(bounds.width >= 90 && bounds.height >= 44);
    if (process.argv[2] && (width === 1440 || width === 390)) {
      const out = path.join(process.argv[2], `sales-${width}.png`);
      await page.screenshot({ path: out, fullPage: false });
    }
    pass("responsive-" + width);
  }
  await page.getByRole("searchbox").fill("Sin coincidencias");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page
    .getByText("No hay ventas que coincidan con estos filtros.")
    .waitFor();
  pass("empty-filter-feedback");
  fail = true;
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "Reintentar consulta" }).click();
  await rows(50);
  pass("error-and-explicit-retry");
  delay = true;
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await page.getByText("Cargando ventas…").waitFor();
  await page
    .getByLabel("Empresa", { exact: true })
    .selectOption(otherTenant, { force: true });
  await page
    .getByText("No hay ventas registradas.", { exact: false })
    .waitFor();
  release?.();
  await page.waitForTimeout(50);
  assert.equal(await page.locator("tbody tr").count(), 0);
  assert.equal(requests.at(-1).tenant, otherTenant);
  pass("late-response-and-business-switch");
  const historyKey = `smartretail.sales-history.550e8400-e29b-41d4-a716-446655440020.${tenant}`;
  await page.evaluate(
    (key) =>
      sessionStorage.setItem(
        key,
        JSON.stringify({
          filters: { q: "wrong", tenantId: "forged" },
          cursors: [""],
        }),
      ),
    historyKey,
  );
  await page.reload();
  await rows(50);
  assert.equal(
    new URL(requests.at(-1).url, "http://127.0.0.1").searchParams.has("q"),
    false,
  );
  pass("corrupt-query-context-is-not-restored");
  const foreignKey = `smartretail.sales-history.550e8400-e29b-41d4-a716-446655440099.${tenant}`;
  await page.evaluate(
    ({ key, foreign }) => {
      sessionStorage.removeItem(key);
      sessionStorage.setItem(
        foreign,
        JSON.stringify({ filters: { q: "Sin coincidencias" }, cursors: [""] }),
      );
    },
    { key: historyKey, foreign: foreignKey },
  );
  await page.reload();
  await rows(50);
  assert.equal(await page.getByRole("searchbox").inputValue(), "");
  assert.ok(
    await page.evaluate(
      (key) => sessionStorage.getItem(key) !== null,
      foreignKey,
    ),
  );
  pass("query-context-is-separated-by-user");
  assert.deepEqual(errors, []);
  assert.equal(externalRequests, 0);
  pass("no-render-errors-or-external-requests");
  await context.close();
  console.log(JSON.stringify({ checks, externalRequests }));
} finally {
  await browser.close();
}
