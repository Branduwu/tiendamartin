// Real PurchasesPanel/contracts/display/controls. Services and transactions are synthetic.
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
  fixture = path.join(root, "scripts/compras-ux-01");
const result = await build({
  plugins: [
    {
      name: "isolated-service-boundaries",
      resolveId(id) {
        if (id.startsWith("virtual:")) return id;
      },
      load(id) {
        if (!id.startsWith("virtual:")) return;
        const file = JSON.stringify(path.join(fixture, "shims.tsx"));
        if (id === "virtual:nav")
          return `export {Navigation as default,companyLabel} from ${file}`;
        if (id === "virtual:financial")
          return `export {PurchasePayable} from ${file}`;
        if (id === "virtual:document")
          return `export {PurchaseDocument as default} from ${file}`;
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
      {
        find: "../components/financial-panel",
        replacement: "virtual:financial",
      },
      {
        find: "../components/purchase-document",
        replacement: "virtual:document",
      },
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
      name: "PurchaseFixture",
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
  user = uid(20),
  location = uid(11),
  product = uid(41),
  supplier = uid(51);
const money = (n) => ({ currency: "MXN", minorUnits: String(n) });
function order(n, status = "ordered") {
  return {
    id: `${String(n).padStart(8, "0")}-e29b-41d4-a716-446655440030`,
    tenantId: tenant,
    supplierId: supplier,
    locationId: location,
    createdBy: user,
    createdAt: `2026-10-${String(24 - n).padStart(2, "0")}T16:00:00Z`,
    status,
    lines: [
      {
        productId: product,
        quantityOrdered: { unit: "piece", milliUnits: "5000" },
        quantityReceived: {
          unit: "piece",
          milliUnits: status === "received" ? "5000" : "0",
        },
        unitCost: money(2500),
      },
    ],
  };
}
const browser = await chromium.launch({ headless: true });
let checks = 0,
  externalRequests = 0;
const pass = (name) => {
  checks++;
  console.log(JSON.stringify({ name, result: "PASS" }));
};
async function session({
  mode = "list",
  width = 1440,
  height = 1000,
  permissions = ["purchases.read", "purchases.write", "purchases.receive"],
} = {}) {
  const context = await browser.newContext({ viewport: { width, height } }),
    page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const orders = [
    order(1),
    order(2, "draft"),
    order(3, "partially_received"),
    order(4, "received"),
    order(5, "cancelled"),
  ];
  orders[2].supplierId = uid(52);
  orders[2].notes =
    'Documento revisado: {"reference":"FAC-ÁRBOL-42","date":"2026-10-21","total":"125.00"}';
  const calls = [],
    records = new Map();
  let failRead = mode === "read-error",
    uncertain = false;
  const id = mode.startsWith("detail")
    ? orders[
        mode === "detail-draft"
          ? 1
          : mode === "detail-received"
            ? 3
            : mode === "detail-cancelled"
              ? 4
              : 0
      ].id
    : null;
  const address = "http://127.0.0.1:55995/" + (id ? `?id=${id}` : "");
  await page.route("**/*", (route) => {
    if (route.request().url() === address)
      return route.fulfill({ contentType: "text/html", body: html });
    externalRequests++;
    return route.abort();
  });
  await page.exposeFunction("purchaseMock", async (url, init) => {
    const method = init.method ?? "GET";
    calls.push({ url, ...init });
    const ok = (body) => ({ status: 200, body });
    if (url === "/api/v1/tenants")
      return ok({
        tenants: [
          { tenantId: tenant, tenantName: "Empresa ficticia", permissions },
        ],
      });
    if (url === "/api/v1/suppliers")
      return ok({
        suppliers: [
          {
            id: supplier,
            tenantId: tenant,
            name: "Café y abarrotes del Centro",
            status: "active",
          },
          {
            id: uid(52),
            tenantId: tenant,
            name: "Distribuidora del Norte",
            status: "inactive",
          },
        ],
      });
    if (url === "/api/v1/products")
      return ok({
        products: [
          {
            id: product,
            tenantId: tenant,
            name: "Producto de prueba con descripción amplia",
            sku: "PROD-01",
            unit: "piece",
            status: "active",
            purchaseCost: money(2500),
            price: money(3500),
          },
        ],
      });
    if (url === "/api/v1/locations")
      return ok({
        locations: [
          {
            id: location,
            tenantId: tenant,
            name: "Sucursal Centro",
            status: "active",
          },
        ],
      });
    if (url === "/api/v1/purchases" && method === "GET")
      return failRead
        ? { status: 503, body: { error: "No pudimos cargar compras." } }
        : ok({ purchases: structuredClone(orders) });
    const match = url.match(
      /^\/api\/v1\/purchases\/([^/]+)(?:\/(order|cancel|receive))?$/,
    );
    if (match) {
      const o = orders.find((x) => x.id === match[1]);
      if (!o) return { status: 404, body: { error: "Orden no disponible" } };
      if (method === "GET") return ok({ purchase: structuredClone(o) });
      if (match[2] === "order") o.status = "ordered";
      if (match[2] === "cancel") o.status = "cancelled";
      if (match[2] === "receive") {
        const cmd = JSON.parse(init.body);
        const replayed = records.has(cmd.id);
        if (!replayed) {
          records.set(cmd.id, cmd);
          for (const line of cmd.lines) {
            const target = o.lines.find((l) => l.productId === line.productId);
            target.quantityReceived.milliUnits = (
              BigInt(target.quantityReceived.milliUnits) +
              BigInt(line.quantity.milliUnits)
            ).toString();
          }
          o.status = o.lines.every(
            (l) =>
              l.quantityOrdered.milliUnits === l.quantityReceived.milliUnits,
          )
            ? "received"
            : "partially_received";
        }
        if (uncertain) {
          uncertain = false;
          return {
            status: 500,
            body: { error: "Respuesta no confirmada. Conserva el intento." },
          };
        }
        return ok({ purchase: structuredClone(o), replayed });
      }
      return ok({ purchase: structuredClone(o) });
    }
    if (url === "/api/v1/purchases" && method === "POST") {
      const cmd = JSON.parse(init.body);
      const o = {
        ...cmd,
        tenantId: tenant,
        createdBy: user,
        createdAt: "2026-10-24T16:00:00Z",
        status: "draft",
        lines: cmd.lines.map((l) => ({
          ...l,
          quantityReceived: { ...l.quantityOrdered, milliUnits: "0" },
        })),
      };
      orders.unshift(o);
      return { status: 201, body: { purchase: o } };
    }
    return { status: 404, body: { error: "Unmocked request" } };
  });
  await page.goto(address);
  await page
    .getByRole("heading", {
      name: id ? "Orden de compra" : "Compras",
      exact: true,
    })
    .waitFor();
  if (permissions.includes("purchases.read"))
    await page
      .getByText("Cargando compras…", { exact: true })
      .waitFor({ state: "hidden" });
  else
    await page
      .getByText("No tienes acceso a compras. Consulta al administrador.")
      .waitFor();
  return {
    page,
    context,
    orders,
    calls,
    records,
    id,
    errors,
    recover() {
      failRead = false;
    },
    uncertain() {
      uncertain = true;
    },
    async close() {
      assert.deepEqual(errors, []);
      await context.close();
    },
  };
}
try {
  let s = await session(),
    p = s.page;
  assert.equal(await p.getByRole("link", { name: /Ver orden / }).count(), 5);
  await p.getByText("Búsqueda en las últimas 100", { exact: false }).waitFor();
  pass("bounded-list-and-five-real-statuses");
  const reads = s.calls.length;
  await p.getByLabel("Buscar proveedor o referencia").fill("CAFE centro");
  assert.equal(await p.getByRole("link", { name: /Ver orden / }).count(), 4);
  assert.equal(s.calls.length, reads);
  pass("accent-insensitive-local-search-no-new-requests");
  await p.getByRole("button", { name: "Limpiar filtros" }).click();
  await p.getByLabel("Buscar proveedor o referencia").fill("arbol-42");
  assert.equal(await p.getByRole("link", { name: /Ver orden / }).count(), 1);
  pass("document-folio-search");
  await p.getByRole("button", { name: "Limpiar filtros" }).click();
  await p.getByRole("combobox", { name: /^Proveedor/ }).selectOption(uid(52));
  await p
    .getByRole("combobox", { name: /^Estado/ })
    .selectOption("partially_received");
  assert.equal(await p.getByRole("link", { name: /Ver orden / }).count(), 1);
  pass("combined-provider-state-filters-inactive-history");
  await p.getByRole("combobox", { name: /^Estado/ }).selectOption("received");
  await p.getByText("No hay coincidencias", { exact: false }).waitFor();
  pass("no-results-is-distinct-from-empty-history");
  await p.getByRole("button", { name: "Limpiar filtros" }).click();
  await p.getByLabel("Desde", { exact: true }).fill("2026-10-23");
  await p.getByLabel("Hasta", { exact: true }).fill("2026-10-23");
  assert.equal(await p.getByRole("link", { name: /Ver orden / }).count(), 1);
  pass("inclusive-creation-date-filter");
  await p.getByLabel("Desde", { exact: true }).fill("2026-10-24");
  await p.getByRole("alert").filter({ hasText: "La fecha" }).waitFor();
  assert.equal(await p.getByRole("link", { name: /Ver orden / }).count(), 0);
  pass("invalid-date-range-explained");
  await p.getByRole("button", { name: "Nueva orden", exact: true }).click();
  await p.getByRole("textbox", { name: /^Notas/ }).fill("Borrador sin guardar");
  assert.equal(
    await p
      .getByRole("button", { name: "Actualizar compras", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await p.getByRole("textbox", { name: /^Notas/ }).inputValue(),
    "Borrador sin guardar",
  );
  pass("refresh-disabled-while-editing-draft");
  await s.close();
  for (const [label, width] of [
    ["desktop", 1440],
    ["tablet", 1024],
    ["small-tablet", 768],
    ["mobile", 390],
    ["small-mobile", 320],
  ]) {
    s = await session({ width });
    p = s.page;
    const size = await p.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    }));
    assert.ok(size.scroll <= size.width, JSON.stringify(size));
    const small = await p
      .locator("main button,main select,main input,main .button-link")
      .evaluateAll((nodes) =>
        nodes
          .filter(
            (n) =>
              n.getBoundingClientRect().height > 0 &&
              n.getBoundingClientRect().height < 43,
          )
          .map((n) => n.textContent),
      );
    assert.deepEqual(small, []);
    await p.screenshot({
      path: path.join(process.argv[2], `purchases-${label}.png`),
      fullPage: true,
    });
    assert.equal(
      await p
        .getByRole("columnheader", { name: "Proveedor y folio", exact: true })
        .count(),
      1,
    );
    pass(`list-responsive-${label}`);
    await s.close();
  }
  s = await session({ mode: "detail" });
  p = s.page;
  await p.getByRole("heading", { name: "Productos de la orden" }).waitFor();
  await p.getByText("Importe de la orden", { exact: true }).waitFor();
  assert.ok((await p.locator("main").innerText()).includes("piezas"));
  assert.ok(!(await p.locator("main").innerText()).includes("piece"));
  pass("detail-costs-totals-and-spanish-units");
  const input = p.getByLabel(/recibir ahora/);
  await input.fill("6");
  await p
    .getByText("La cantidad excede lo pendiente.", { exact: true })
    .waitFor();
  assert.equal(
    await p
      .getByRole("button", { name: "Confirmar recepción", exact: true })
      .isDisabled(),
    true,
  );
  await input.fill("1.5");
  await p.getByText("Usa piezas enteras.", { exact: true }).waitFor();
  pass("existing-receipt-validations-preserved");
  await input.fill("2");
  await p
    .getByRole("button", { name: "Confirmar recepción", exact: true })
    .dblclick();
  await p
    .getByText("Recepción registrada y existencias actualizadas.", {
      exact: true,
    })
    .waitFor();
  assert.equal(s.records.size, 1);
  assert.equal(
    s.calls.filter((c) => c.method === "POST" && c.url.endsWith("/receive"))
      .length,
    1,
  );
  pass("receipt-single-flight-original-command");
  await s.close();
  s = await session({ mode: "detail" });
  p = s.page;
  s.uncertain();
  await p.getByLabel(/recibir ahora/).fill("2");
  await p
    .getByRole("button", { name: "Confirmar recepción", exact: true })
    .click();
  await p
    .getByText("Respuesta no confirmada. Conserva el intento.", { exact: true })
    .waitFor();
  const cmd = s.calls.find(
    (c) => c.url.endsWith("/receive") && c.method === "POST",
  ).body;
  await p.reload();
  await p
    .getByRole("button", { name: "Reintentar misma recepción", exact: true })
    .waitFor();
  await p
    .getByRole("button", { name: "Reintentar misma recepción", exact: true })
    .click();
  await p
    .getByText("Recepción ya registrada; no se duplicaron existencias.", {
      exact: true,
    })
    .waitFor();
  assert.equal(s.records.size, 1);
  const commands = s.calls.filter(
    (c) => c.url.endsWith("/receive") && c.method === "POST",
  );
  assert.equal(commands[1].body, cmd);
  pass("uncertain-response-reload-same-id-no-duplicate");
  await s.close();
  s = await session({ mode: "detail-draft" });
  p = s.page;
  await p.getByRole("button", { name: "Confirmar orden", exact: true }).click();
  await p
    .getByText("Orden confirmada. Ya puedes recibir mercancía.", {
      exact: true,
    })
    .waitFor();
  await p
    .getByRole("heading", { name: "Recibir mercancía", exact: true })
    .waitFor();
  pass("confirm-order-keeps-existing-transition");
  p.once("dialog", (d) => d.dismiss());
  await p.getByRole("button", { name: "Cancelar orden", exact: true }).click();
  assert.equal(s.calls.filter((c) => c.url.endsWith("/cancel")).length, 0);
  pass("cancel-dialog-dismiss-no-write");
  p.once("dialog", (d) => d.accept());
  await p.getByRole("button", { name: "Cancelar orden", exact: true }).click();
  await p
    .getByText("Orden cancelada. Las recepciones anteriores se conservan.", {
      exact: true,
    })
    .waitFor();
  pass("cancel-dialog-confirm-existing-behavior");
  await s.close();
  for (const mode of ["detail-received", "detail-cancelled"]) {
    s = await session({ mode, width: 320 });
    p = s.page;
    assert.equal(
      await p
        .getByRole("button", { name: "Confirmar recepción", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await p
        .getByRole("button", { name: "Cancelar orden", exact: true })
        .count(),
      0,
    );
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    pass(mode + "-no-forbidden-actions-mobile");
    await s.close();
  }
  s = await session({
    mode: "detail",
    permissions: ["purchases.read"],
    width: 390,
  });
  p = s.page;
  assert.equal(
    await p
      .getByRole("heading", { name: "Recibir mercancía", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await p
      .getByRole("button", { name: "Cancelar orden", exact: true })
      .count(),
    0,
  );
  await p.screenshot({
    path: path.join(process.argv[2], "purchase-detail-mobile.png"),
    fullPage: true,
  });
  pass("read-only-permission-no-mutation-controls");
  await s.close();
  s = await session({ mode: "read-error" });
  p = s.page;
  await p
    .getByText("No se pudo consultar el listado.", { exact: false })
    .waitFor();
  assert.equal(
    await p.getByText("Aún no hay órdenes.", { exact: false }).count(),
    0,
  );
  s.recover();
  await p
    .getByRole("button", { name: "Actualizar compras", exact: true })
    .click();
  await p
    .getByRole("link", { name: /Ver orden / })
    .first()
    .waitFor();
  pass("read-error-distinct-from-empty-and-explicit-recovery");
  await s.close();
  s = await session({ permissions: [] });
  assert.equal(s.calls.filter((c) => c.url === "/api/v1/purchases").length, 0);
  pass("no-company-permission-no-purchase-reads");
  await s.close();
  assert.equal(externalRequests, 0);
  pass("zero-external-service-requests");
  console.log(JSON.stringify({ checks, externalRequests }));
} finally {
  await browser.close();
}
