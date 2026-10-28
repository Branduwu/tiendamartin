import {
  fixturePolicy,
  cspHtml,
  observePolicy,
  assertPolicyClean,
} from "../csp-01/fixture-policy.mjs";
const cspPolicy = await fixturePolicy();
// Real DashboardPanel/contracts/display/controls. Services and transactions are synthetic.
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
  fixture = path.join(root, "scripts/dashboard-ux-01");
const result = await build({
  plugins: [
    {
      name: "isolated-navigation",
      resolveId(id) {
        if (id.startsWith("virtual:")) return id;
      },
      load(id) {
        const file = JSON.stringify(path.join(fixture, "shims.tsx"));
        if (id === "virtual:nav")
          return `export {Navigation as default,companyLabel} from ${file}`;
        if (id === "virtual:setup")
          return `export {InitialSetup as default} from ${file}`;
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
      { find: "../components/app-navigation", replacement: "virtual:nav" },
      { find: "../help/initial-setup", replacement: "virtual:setup" },
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
  define: {
    "process.env.NODE_ENV": cspPolicy ? '"production"' : '"development"',
  },
  build: {
    write: false,
    minify: false,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: path.join(fixture, "fixture.tsx"),
      name: "DashboardFixture",
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

const uid = (n) => `550e8400-e29b-41d4-a716-${String(n).padStart(12, "0")}`,
  tenant = uid(1),
  otherTenant = uid(2);
function metrics(gross = "123456", count = "5") {
  return {
    gross,
    count,
    average: "24691",
    cash: gross,
    card: "0",
    refunds: "0",
    net: gross,
    baseGross: gross,
    discounts: "0",
    taxCollected: "0",
    taxRefunded: "0",
    netCommercial: gross,
    customers: "1",
    associated: "2",
    general: "3",
  };
}
function report(mode = "normal", tenantId = tenant, query = "period=today") {
  const q = new URLSearchParams(query),
    filters = {
      from:
        q.get("from") ??
        (q.get("period") === "7d" ? "2026-10-18" : "2026-10-24"),
      to: q.get("to") ?? "2026-10-24",
      ...Object.fromEntries(
        [...q].filter(([k]) =>
          [
            "locationId",
            "productId",
            "customerId",
            "supplierId",
            "paymentMethod",
          ].includes(k),
        ),
      ),
    };
  const sales = metrics(
    mode === "large"
      ? "900719925474099312345"
      : mode === "zero" || mode === "no-days" || mode === "free"
        ? "0"
        : "123456",
    mode === "zero" || mode === "no-days" ? "0" : "5",
  );
  if (mode === "zero") {
    sales.average = "0";
    sales.customers = "0";
    sales.associated = "0";
    sales.general = "0";
  }
  if (mode === "negative") {
    sales.net = "-12345";
    sales.netCommercial = "-12345";
    sales.refunds = "135801";
  }
  return {
    filters,
    timezone: "America/Mexico_City",
    today: "2026-10-24",
    context: {
      businessName: tenantId === tenant ? "Negocio de prueba" : "Otro negocio",
      branchName: "Sucursal Centro",
      locale: "es-MX",
      currency: "MXN",
    },
    todaySales: metrics("123456"),
    sales,
    days:
      mode === "no-days"
        ? []
        : [
            { ...sales, date: filters.from },
            ...(filters.from !== filters.to
              ? [{ ...sales, date: filters.to }]
              : []),
          ],
    products:
      mode === "zero" || mode === "no-days"
        ? []
        : [
            {
              id: uid(41),
              name: "Café molido de prueba con un nombre amplio",
              unit: "piece",
              quantity: "5000",
              revenue: sales.gross,
              stock: "12000",
            },
          ],
    inventory: {
      low: "1",
      empty: "0",
      alerts: [
        {
          id: uid(41),
          name: "Café molido de prueba",
          unit: "piece",
          stock: "2000",
          minimum: "5000",
          locationId: uid(11),
          locationName: "Sucursal Centro",
          state: "low",
        },
      ],
    },
    purchases: {
      created: "2",
      pending: "1",
      partial: "0",
      received: "1",
      orderedAmount: "10000",
      receivedAmount: "5000",
    },
    cash: {
      open: "1",
      closed: "0",
      expected: "10000",
      shortage: "0",
      surplus: "0",
      cashIn: "0",
      cashOut: "0",
    },
    credit:
      mode === "minimal"
        ? undefined
        : {
            outstanding: "5000",
            generated: "5000",
            collected: "0",
            openAccounts: "1",
          },
    financial:
      mode === "minimal"
        ? undefined
        : {
            outstanding: "1000",
            expenses: "0",
            supplierPayments: "0",
            expenseCashOut: "0",
            supplierCashOut: "0",
          },
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
  mode = "normal",
  width = 1440,
  height = 1000,
  permission = true,
} = {}) {
  const context = await browser.newContext({ viewport: { width, height } }),
    page = await context.newPage(),
    calls = [],
    errors = [];
  let fail = mode === "error",
    optionFail = mode === "options-error",
    hold = null,
    release = null;
  page.on("pageerror", (e) => errors.push(e.message));
  const address = "http://127.0.0.1:55997/";
  await page.route("**/*", (route) => {
    if (route.request().url() === address)
      return route.fulfill({
        contentType: "text/html",
        body: cspHtml(html, cspPolicy),
        ...(cspPolicy
          ? { headers: { [cspPolicy.header]: cspPolicy.value } }
          : {}),
      });
    externalRequests++;
    return route.abort();
  });
  await page.exposeFunction("reportMock", async (url, init) => {
    calls.push({ url, ...init });
    const ok = (body) => ({ status: 200, body });
    const t = init.headers["x-tenant-id"];
    if (url === "/api/v1/tenants")
      return ok({
        tenants: [tenant, otherTenant].map((tenantId) => ({
          tenantId,
          tenantName: tenantId === tenant ? "Empresa uno" : "Empresa dos",
          permissions: permission ? ["reports.read"] : [],
        })),
      });
    if (url === "/api/v1/reports/options")
      return optionFail
        ? { status: 503, body: { error: "Opciones no disponibles" } }
        : ok({
            locations: [{ id: uid(11), name: "Sucursal Centro" }],
            products: [{ id: uid(41), name: "Café molido de prueba" }],
            customers: [],
            suppliers: [],
          });
    if (url.startsWith("/api/v1/reports?")) {
      if (hold) await hold;
      if (fail)
        return {
          status: 503,
          body: { error: "Consulta temporalmente no disponible" },
        };
      return ok(report(mode, t, url.split("?")[1]));
    }
    if (
      url.startsWith("/api/v1/reports/sales.csv?") ||
      url.startsWith("/api/v1/reports/products.csv?")
    )
      return ok("CSV sintético");
    return { status: 404, body: { error: "Unmocked request" } };
  });
  if (mode === "loading") hold = new Promise((r) => (release = r));
  if (cspPolicy) await observePolicy(page);
  await page.goto(address);
  await page.getByRole("heading", { level: 1 }).waitFor();
  if (mode !== "loading" && permission)
    await page
      .getByText("Consultando reportes…", { exact: false })
      .waitFor({ state: "hidden" });
  if (!permission)
    await page
      .getByText("No tienes permiso para consultar reportes.", { exact: true })
      .waitFor();
  return {
    context,
    page,
    calls,
    errors,
    fail(v = true) {
      fail = v;
    },
    recover() {
      fail = false;
      optionFail = false;
    },
    hold() {
      hold = new Promise((r) => (release = r));
    },
    release() {
      release?.();
      hold = null;
    },
    async close() {
      assert.deepEqual(errors, []);
      await context.close();
    },
  };
}
async function openDetails(p) {
  await p
    .locator("details")
    .evaluateAll((nodes) => nodes.forEach((n) => (n.open = true)));
}
if (process.argv.includes("--csp-smoke")) {
  try {
    const s = await session();
    await assertPolicyClean(s.page);
    assert.equal(s.errors.length, 0);
    assert.ok(s.calls.some((c) => c.url.startsWith("/api/v1/reports?")));
    await s.close();
    console.log(JSON.stringify({ cspDashboard: "PASS", externalRequests }));
  } finally {
    await browser.close();
  }
  process.exit(0);
}

try {
  let s = await session(),
    p = s.page;
  await p
    .getByRole("heading", { name: "Resumen del periodo", exact: true })
    .waitFor();
  assert.equal(await p.locator(".report-kpis > div").count(), 4);
  assert.ok(
    (await p.locator(".report-kpis").innerText()).includes("$1,234.56 MXN"),
  );
  assert.ok(
    (await p.locator(".report-kpis").innerText()).includes("MXN · periodo"),
  );
  pass("four-existing-primary-metrics-exact-money-period");
  await openDetails(p);
  assert.equal(
    await p
      .locator(".metric-rows dt")
      .filter({ hasText: "Ventas de hoy" })
      .count(),
    0,
  );
  assert.ok(
    (await p.locator(".metric-rows").innerText()).includes(
      "Saldo pendiente de crédito (actual)",
    ),
  );
  pass("today-duplicate-hidden-current-balances-preserved");
  assert.equal(
    await p
      .getByRole("img", { name: /Tendencia de ventas completadas/ })
      .count(),
    1,
  );
  assert.equal(await p.locator(".trend-dot").count(), 1);
  assert.equal(
    await p
      .getByRole("columnheader", { name: "Efectivo", exact: true })
      .count(),
    1,
  );
  assert.ok(!(await p.locator("main").innerText()).includes("Cash in"));
  pass("single-day-chart-and-spanish-labels");
  await p.locator('[name="period"]').selectOption("7d");
  await p.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
  await p.waitForFunction(
    () =>
      document.querySelector(".trend-dot") === null &&
      document.querySelector(".report-kpis"),
  );
  assert.equal(
    await p
      .locator(".metric-rows dt")
      .filter({ hasText: "Ventas de hoy" })
      .count(),
    1,
  );
  assert.equal(
    await p.locator(".trend-line").getAttribute("points"),
    "10,15 710,15",
  );
  pass("seven-day-filter-preserves-query-and-chart-coordinates");
  await p.locator('[name="period"]').selectOption("custom");
  await p.locator('[name="from"]').fill("2026-10-01");
  await p.locator('[name="to"]').fill("2026-10-24");
  await p.locator('[name="locationId"]').selectOption(uid(11));
  await p.locator('[name="paymentMethod"]').selectOption("card");
  await p.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
  await p
    .getByRole("heading", { name: "Resumen del periodo", exact: true })
    .waitFor();
  const req = s.calls
    .filter((c) => c.url.startsWith("/api/v1/reports?"))
    .at(-1);
  const q = new URLSearchParams(req.url.split("?")[1]);
  assert.equal(q.get("from"), "2026-10-01");
  assert.equal(q.get("to"), "2026-10-24");
  assert.equal(q.get("locationId"), uid(11));
  assert.equal(q.get("paymentMethod"), "card");
  assert.equal(req.headers["x-tenant-id"], tenant);
  pass("custom-period-location-payment-contract-preserved");
  await p
    .getByRole("button", { name: "Exportar ventas CSV", exact: true })
    .click();
  assert.ok(
    s.calls.some(
      (c) =>
        c.url.startsWith("/api/v1/reports/sales.csv?") &&
        c.url.includes("paymentMethod=card"),
    ),
  );
  pass("export-retains-current-query-and-tenant");
  await s.close();
  s = await session({ mode: "loading" });
  p = s.page;
  await p.getByText("Consultando reportes…", { exact: false }).waitFor();
  assert.equal(await p.locator(".report-kpis").count(), 0);
  s.release();
  await p.locator(".report-kpis").waitFor();
  pass("initial-loading-never-fabricates-zero");
  await s.close();
  s = await session();
  p = s.page;
  s.hold();
  await p.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
  await p.getByText("Consultando reportes…", { exact: false }).waitFor();
  assert.equal(await p.locator(".report-kpis").count(), 0);
  s.fail();
  s.release();
  await p
    .getByRole("heading", {
      name: "No pudimos consultar este periodo",
      exact: true,
    })
    .waitFor();
  assert.equal(await p.locator(".report-kpis").count(), 0);
  s.recover();
  await p
    .getByRole("button", { name: "Reintentar reporte", exact: true })
    .click();
  await p.locator(".report-kpis").waitFor();
  pass("same-query-refresh-hides-stale-values-error-retry");
  await s.close();
  s = await session({ mode: "error" });
  p = s.page;
  assert.equal(await p.locator(".report-kpis").count(), 0);
  assert.equal(
    await p
      .getByText("Sin ventas ni devoluciones en este periodo.", { exact: true })
      .count(),
    0,
  );
  pass("report-error-is-not-zero-sales");
  s.recover();
  await p
    .locator("label[hidden] select")
    .selectOption(otherTenant, { force: true });
  await p
    .locator(".dashboard-context")
    .getByText(/Otro negocio/)
    .waitFor();
  assert.ok(
    s.calls.some(
      (c) =>
        c.headers["x-tenant-id"] === otherTenant &&
        c.url.startsWith("/api/v1/reports?"),
    ),
  );
  pass("company-switch-clears-old-report-error");
  await s.close();
  s = await session({ mode: "zero" });
  p = s.page;
  await p
    .getByText("Sin ventas ni devoluciones en este periodo.", { exact: true })
    .waitFor();
  await p
    .getByText("Los importes diarios de ventas son cero", { exact: false })
    .waitFor();
  assert.equal(await p.locator(".trend-line").count(), 0);
  assert.ok(
    (await p.locator(".report-kpis").innerText()).includes("$0.00 MXN"),
  );
  pass("successful-zero-sales-clearly-distinct-empty-chart");
  await s.close();
  s = await session({ mode: "no-days" });
  await s.page
    .getByText("Sin datos diarios para el periodo seleccionado.", {
      exact: true,
    })
    .waitFor();
  pass("missing-daily-data-explicit-state");
  await s.close();
  s = await session({ mode: "free" });
  p = s.page;
  await p
    .getByText("Los importes diarios de ventas son cero", { exact: false })
    .waitFor();
  assert.ok((await p.locator(".report-kpis").innerText()).includes("5"));
  pass("zero-revenue-does-not-mean-zero-operations");
  await s.close();
  s = await session({ mode: "negative" });
  p = s.page;
  assert.ok(
    (await p.locator(".report-kpis").innerText()).includes("-$123.45 MXN"),
  );
  await openDetails(p);
  assert.ok(
    (await p.locator(".daily-detail").innerText()).includes("-$123.45 MXN"),
  );
  pass("negative-net-remains-exact-and-renders");
  await s.close();
  for (const [name, width] of [
    ["desktop", 1440],
    ["tablet", 1024],
    ["small-tablet", 768],
    ["mobile", 390],
    ["small-mobile", 320],
  ]) {
    s = await session({ mode: "large", width });
    p = s.page;
    await openDetails(p);
    assert.ok(
      (await p.locator(".report-kpis").innerText()).includes(
        "$9,007,199,254,740,993,123.45 MXN",
      ),
    );
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const svg = await p.locator(".report-trend svg").boundingBox();
    assert.ok(svg.width > 150 && svg.height >= 150);
    const small = await p
      .locator("main button,main input,main select,main summary")
      .evaluateAll((nodes) =>
        nodes
          .filter((n) => {
            const r = n.getBoundingClientRect();
            return r.height > 0 && r.height < 43;
          })
          .map((n) => n.textContent),
      );
    assert.deepEqual(small, []);
    await p.screenshot({
      path: path.join(process.argv[2], `dashboard-${name}.png`),
      fullPage: true,
    });
    pass(`exact-large-money-chart-and-controls-${name}`);
    await s.close();
  }
  s = await session({ mode: "options-error" });
  p = s.page;
  assert.equal(await p.locator(".report-kpis").count(), 1);
  await p.locator(".dashboard-advanced summary").click();
  assert.equal(await p.locator('[name="locationId"]').isDisabled(), true);
  s.recover();
  await p.getByRole("button", { name: "Aplicar filtros", exact: true }).click();
  await p.waitForFunction(
    () => !document.querySelector('[name="locationId"]').disabled,
  );
  pass("options-error-independent-and-explicit-recovery");
  await s.close();
  s = await session({ mode: "minimal" });
  p = s.page;
  await openDetails(p);
  assert.equal(
    await p
      .getByText("Saldo pendiente de crédito (actual)", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await p.getByText("Cuentas por pagar (actual)", { exact: true }).count(),
    0,
  );
  pass("optional-financial-sections-not-invented");
  await s.close();
  s = await session({ permission: false });
  assert.equal(
    s.calls.filter((c) => c.url.startsWith("/api/v1/reports")).length,
    0,
  );
  pass("no-report-permission-no-report-requests");
  await s.close();
  assert.equal(externalRequests, 0);
  pass("zero-external-service-requests");
  console.log(JSON.stringify({ checks, externalRequests }));
} finally {
  await browser.close();
}
